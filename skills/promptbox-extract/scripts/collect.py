#!/usr/bin/env python3
"""找到 AI 工具的聊天记录，抽出用户说过的话，去噪、分组，写成方便判断的摘要。

只用 Python 标准库（3.8+）。全部在本机运行，不联网。

用法：
  python3 collect.py scan                         # 看本机有哪些记录，不读内容
  python3 collect.py extract --out 工作目录        # 抽取、分组，写 summary.json / groups.json
  python3 collect.py show --work 工作目录 --kind tasks --offset 0 --limit 20
  python3 collect.py existing --work 工作目录      # 收集已有的规则文件和 Skill，用来去重
"""

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

# ---------------------------------------------------------------------------
# 基础

MAX_STORED = 400          # 每句话最多保留多少字参与分组
MAX_SAMPLE = 300          # 摘要里每句原话最多显示多少字
MAX_SINGLE = 1500         # 单次长提示词最多显示多少字
TASK_MIN = 3              # 任务至少出现几次才进摘要
CORRECTION_MIN = 3        # 纠正至少出现几次才进摘要


def home(args):
    return Path(args.home).expanduser() if getattr(args, "home", None) else Path.home()


def to_time(value, fallback=None):
    """各种时间格式转成带时区的 datetime。"""
    if isinstance(value, (int, float)) and value > 0:
        seconds = value / 1000 if value > 1e12 else value
        return dt.datetime.fromtimestamp(seconds, tz=dt.timezone.utc)
    if isinstance(value, str) and value:
        text = value.strip().replace("Z", "+00:00")
        try:
            parsed = dt.datetime.fromisoformat(text)
        except ValueError:
            match = re.match(r"(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})", text)
            if not match:
                return fallback
            parsed = dt.datetime.fromisoformat(match.group(1).replace(" ", "T"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)
    return fallback


def local_day(moment):
    return moment.astimezone().date().isoformat() if moment else ""


def clip(text, limit):
    return text if len(text) <= limit else text[:limit] + "……"


# ---------------------------------------------------------------------------
# 隐私：密钥、手机号这类内容在写出任何文件之前就替换掉

SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}"),
    re.compile(r"xox[abprs]-[A-Za-z0-9\-]{10,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"AIza[0-9A-Za-z_\-]{30,}"),
    re.compile(r"eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"(?i)\b(?:password|passwd|pwd|token|secret|api[_-]?key)\s*[:=]\s*\S+"),
    re.compile(r"(?:密码|口令|密钥|令牌)\s*[:：是为]\s*\S+"),
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),
    re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"),
    re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)"),
]


def redact(text):
    for pattern in SECRET_PATTERNS:
        text = pattern.sub("[已隐藏]", text)
    return text


# ---------------------------------------------------------------------------
# 自动注入的内容

INJECTED_PREFIX = re.compile(
    r"^\s*(<(environment_context|user_instructions|user_shell_command|turn_aborted|permissions instructions|instructions|system-reminder)\b"
    r"|# AGENTS\.md instructions|<INSTRUCTIONS>)",
    re.I,
)
WHOLE_TAG = re.compile(r"^\s*<([a-z][a-z0-9_-]*)>[\s\S]*</\1>\s*$", re.I)
CLAUDE_NOISE = re.compile(
    r"<command-name>|<command-message>|<command-args>|<local-command-stdout>|<local-command-stderr>"
    r"|^\s*\[Request interrupted|^\s*Caveat: The messages below"
)
REMINDER = re.compile(r"<system-reminder>[\s\S]*?</system-reminder>")
USER_QUERY = re.compile(r"<user_query>([\s\S]*?)</user_query>")
WORKBUDDY_TAGS = (
    "system-reminder|additional_data|current_time|memory_and_skills_reminder|connector-status|user_info|identity_context"
    "|product_identity|project_context|project_layout|tone_and_style|previous_tool_call|previous_assistant_message|result"
    "|image_local_path|cb_summary|conversation_history_summary|task-notification"
)
WORKBUDDY_BLOCK = re.compile(r"<(%s)\b[^>]*>[\s\S]*?</\1>" % WORKBUDDY_TAGS)


def is_injected(text):
    return bool(INJECTED_PREFIX.search(text) or WHOLE_TAG.match(text))


def text_of(content):
    """字符串，或者 [{type: text/input_text/output_text, text}] 块。"""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") in ("text", "input_text", "output_text") and isinstance(block.get("text"), str):
            parts.append(block["text"])
    return "\n".join(part for part in parts if part)


def read_jsonl(text):
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict):
            yield row


# ---------------------------------------------------------------------------
# 各工具的解析器：统一成 {tool, session, cwd, title, messages: [{role, text, at}]}


def parse_codex(text, key):
    events, items = [], []
    cwd, last = "", None
    for row in read_jsonl(text):
        at = to_time(row.get("timestamp"), last)
        last = at
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else row
        if row.get("type") == "session_meta" and isinstance(payload.get("cwd"), str):
            cwd = payload["cwd"]
            continue
        if row.get("type") == "event_msg":
            kind = payload.get("type")
            if kind == "user_message" and isinstance(payload.get("message"), str):
                events.append({"role": "user", "text": payload["message"], "at": at})
            elif kind == "agent_message" and isinstance(payload.get("message"), str):
                events.append({"role": "assistant", "text": payload["message"], "at": at})
            continue
        if payload.get("type") == "message" and payload.get("role") in ("user", "assistant"):
            body = text_of(payload.get("content"))
            if body and not (payload["role"] == "user" and is_injected(body)):
                items.append({"role": payload["role"], "text": body, "at": at})
    if any(message["role"] == "user" for message in events):
        messages = [m for m in events if not (m["role"] == "user" and is_injected(m["text"]))]
        if not any(m["role"] == "assistant" for m in messages):
            messages = sorted(messages + [m for m in items if m["role"] == "assistant"], key=lambda m: m["at"] or dt.datetime.min.replace(tzinfo=dt.timezone.utc))
    else:
        messages = items
    if not any(m["role"] == "user" for m in messages):
        return None
    return {"tool": "codex", "session": key, "cwd": cwd, "title": "", "messages": messages}


def parse_claude_code(text, key, tool="claude-code"):
    messages, title, cwd, last = [], "", "", None
    for row in read_jsonl(text):
        if row.get("type") == "summary" and isinstance(row.get("summary"), str):
            title = row["summary"]
        if row.get("isSidechain") is True:
            continue
        if isinstance(row.get("cwd"), str):
            cwd = row["cwd"]
        at = to_time(row.get("timestamp"), last)
        last = at
        message = row.get("message")
        if not isinstance(message, dict):
            continue
        if row.get("type") == "user" and message.get("role") == "user":
            if row.get("isMeta") is True:
                continue
            content = message.get("content")
            if isinstance(content, list) and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
                continue
            body = REMINDER.sub("", text_of(content)).strip()
            if not body or CLAUDE_NOISE.search(body) or is_injected(body):
                continue
            messages.append({"role": "user", "text": body, "at": at})
        elif row.get("type") == "assistant" and message.get("role") == "assistant":
            messages.append({"role": "assistant", "text": text_of(message.get("content")), "at": at})
    if not any(m["role"] == "user" for m in messages):
        return None
    return {"tool": tool, "session": key, "cwd": cwd, "title": title, "messages": messages}


def clean_workbuddy(body):
    queries = USER_QUERY.findall(body)
    if queries:
        return "\n".join(query.strip() for query in queries).strip()
    return WORKBUDDY_BLOCK.sub("", body).strip()


def parse_workbuddy(text, key, tool="workbuddy"):
    messages, title, cwd, last = [], "", "", None
    for row in read_jsonl(text):
        if row.get("type") == "ai-title" and isinstance(row.get("aiTitle"), str):
            title = row["aiTitle"]
        if isinstance(row.get("cwd"), str):
            cwd = row["cwd"]
        at = to_time(row.get("timestamp"), last)
        last = at
        if row.get("type") != "message" or row.get("role") not in ("user", "assistant"):
            continue
        body = text_of(row.get("content"))
        if row["role"] == "user":
            body = clean_workbuddy(body)
            if not body or is_injected(body):
                continue
        messages.append({"role": row["role"], "text": body, "at": at})
    if not any(m["role"] == "user" for m in messages):
        return None
    return {"tool": tool, "session": key, "cwd": cwd, "title": title, "messages": messages}


def parse_auto(text, key, tool):
    """WorkBuddy、CodeBuddy 同一个内核，不同版本可能用两种写法，按实际字段选解析方式。"""
    for row in read_jsonl(text):
        if row.get("type") in ("user", "assistant") and isinstance(row.get("message"), dict):
            return parse_claude_code(text, key, tool=tool)
        if row.get("type") == "message" and row.get("role") in ("user", "assistant"):
            return parse_workbuddy(text, key, tool=tool)
    return None


def parse_history(text, key_prefix, tool):
    """Claude Code、CodeBuddy 的输入历史：只有用户的话。按项目和日期分成会话。"""
    sessions = {}
    for row in read_jsonl(text):
        body = row.get("display")
        if not isinstance(body, str) or not body.strip():
            continue
        at = to_time(row.get("timestamp"))
        project = row.get("project") if isinstance(row.get("project"), str) else ""
        key = "%s:%s:%s" % (key_prefix, project, local_day(at))
        conversation = sessions.setdefault(key, {"tool": tool, "session": key, "cwd": project, "title": "", "messages": [], "historyOnly": True})
        conversation["messages"].append({"role": "user", "text": body, "at": at})
    return list(sessions.values())


def parse_chatgpt(conversation, index):
    mapping = conversation.get("mapping")
    if not isinstance(mapping, dict):
        return None
    fallback = to_time(conversation.get("create_time"))
    node_id = conversation.get("current_node") or (list(mapping)[-1] if mapping else None)
    chain, seen = [], set()
    while node_id and node_id not in seen:
        seen.add(node_id)
        node = mapping.get(node_id)
        if not isinstance(node, dict):
            break
        message = node.get("message") if isinstance(node.get("message"), dict) else None
        if message:
            role = (message.get("author") or {}).get("role")
            content = message.get("content") or {}
            hidden = (message.get("metadata") or {}).get("is_visually_hidden_from_conversation")
            if role in ("user", "assistant") and not hidden and content.get("content_type") in ("text", "multimodal_text"):
                parts = [part for part in content.get("parts") or [] if isinstance(part, str)]
                body = "\n".join(parts).strip()
                if body or role == "assistant":
                    chain.append({"role": role, "text": body, "at": to_time(message.get("create_time"), fallback)})
        node_id = node.get("parent")
    chain.reverse()
    if not any(m["role"] == "user" for m in chain):
        return None
    ident = conversation.get("id") or conversation.get("conversation_id") or index
    return {"tool": "chatgpt", "session": "chatgpt:%s" % ident, "cwd": "", "title": conversation.get("title") or "", "messages": chain}


def parse_claude_web(conversation, index):
    messages = []
    fallback = to_time(conversation.get("created_at"))
    for message in conversation.get("chat_messages") or []:
        if not isinstance(message, dict):
            continue
        role = {"human": "user", "assistant": "assistant"}.get(message.get("sender"))
        if not role:
            continue
        body = message.get("text") if isinstance(message.get("text"), str) and message.get("text") else text_of(message.get("content"))
        messages.append({"role": role, "text": (body or "").strip(), "at": to_time(message.get("created_at"), fallback)})
    if not any(m["role"] == "user" and m["text"] for m in messages):
        return None
    return {"tool": "claude-web", "session": "claude-web:%s" % (conversation.get("uuid") or index), "cwd": "", "title": conversation.get("name") or "", "messages": messages}


def parse_web_export(text):
    try:
        data = json.loads(text)
    except ValueError:
        return []
    items = data if isinstance(data, list) else (data.get("conversations") if isinstance(data, dict) else None)
    if not isinstance(items, list):
        return []
    out = []
    for index, conversation in enumerate(items):
        if not isinstance(conversation, dict):
            continue
        parsed = parse_chatgpt(conversation, index) if "mapping" in conversation else parse_claude_web(conversation, index) if "chat_messages" in conversation else None
        if parsed:
            out.append(parsed)
    return out


def parse_extra(text):
    """Agent 为不认识的工具转出来的统一格式。"""
    sessions = {}
    for row in read_jsonl(text):
        role = row.get("role")
        if role not in ("user", "assistant"):
            continue
        tool = str(row.get("tool") or "other")
        key = str(row.get("session") or "%s:extra" % tool)
        conversation = sessions.setdefault(key, {"tool": tool, "session": key, "cwd": str(row.get("cwd") or ""), "title": "", "messages": []})
        conversation["messages"].append({"role": role, "text": str(row.get("text") or ""), "at": to_time(row.get("at"))})
    for conversation in sessions.values():
        conversation["messages"].sort(key=lambda m: m["at"] or dt.datetime.min.replace(tzinfo=dt.timezone.utc))
    return list(sessions.values())


# ---------------------------------------------------------------------------
# 找文件


def walk(root, predicate, max_depth=6):
    root = Path(root)
    if not root.is_dir():
        return []
    found = []
    base_depth = len(root.parts)
    for current, dirs, files in os.walk(root):
        depth = len(Path(current).parts) - base_depth
        dirs[:] = [d for d in dirs if not d.startswith(".") and d != "subagents" and depth < max_depth]
        for name in files:
            path = Path(current) / name
            if predicate(path):
                found.append(path)
    return sorted(found)


def source_table(base):
    return {
        "codex": {
            "name": "Codex",
            "files": lambda: walk(base / ".codex" / "sessions", lambda p: p.name.startswith("rollout-") and (p.name.endswith(".jsonl") or p.name.endswith(".jsonl.zst")))
            + walk(base / ".codex" / "archived_sessions", lambda p: p.name.startswith("rollout-") and (p.name.endswith(".jsonl") or p.name.endswith(".jsonl.zst"))),
        },
        "claude-code": {
            "name": "Claude Code",
            "files": lambda: walk(base / ".claude" / "projects", lambda p: p.suffix == ".jsonl" and not p.name.startswith("agent-")),
            "history": base / ".claude" / "history.jsonl",
        },
        "workbuddy": {
            "name": "WorkBuddy",
            "files": lambda: walk(base / ".workbuddy" / "projects", lambda p: p.suffix == ".jsonl" and not p.name.startswith("agent-"), max_depth=1),
        },
        "codebuddy": {
            "name": "CodeBuddy",
            "files": lambda: walk(base / ".codebuddy" / "projects", lambda p: p.suffix == ".jsonl" and not p.name.startswith("agent-"), max_depth=1),
            "history": base / ".codebuddy" / "history.jsonl",
        },
    }


def read_file(path):
    """普通文件直接读；.zst 有 zstd 命令才读，否则返回 None。"""
    if path.name.endswith(".zst"):
        zstd = shutil.which("zstd")
        if not zstd:
            return None
        try:
            return subprocess.run([zstd, "-dc", str(path)], capture_output=True, check=True).stdout.decode("utf-8", "replace")
        except (subprocess.CalledProcessError, OSError):
            return None
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def cmd_scan(args):
    base = home(args)
    report = {"sources": [], "notes": []}
    for tool, info in source_table(base).items():
        files = info["files"]()
        compressed = [f for f in files if f.name.endswith(".zst")]
        history = info.get("history")
        has_history = bool(history and history.exists())
        if not files and not has_history:
            continue
        size = sum(f.stat().st_size for f in files if f.exists())
        entry = {"tool": tool, "name": info["name"], "files": len(files), "compressed": len(compressed), "megabytes": round(size / 1e6, 1)}
        if has_history:
            entry["inputHistory"] = str(history)
        report["sources"].append(entry)
        if compressed and not shutil.which("zstd"):
            report["notes"].append("%s 有 %d 个压缩的旧会话（.jsonl.zst），本机没有 zstd 命令，读不了，会跳过。" % (info["name"], len(compressed)))
    if not report["sources"]:
        report["notes"].append("没有在默认位置找到 Codex、Claude Code、WorkBuddy、CodeBuddy 的记录。")
    print(json.dumps(report, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------------------
# 分类：任务、纠正、明确要求

ACKNOWLEDGEMENT = re.compile(
    r"^(好的?|好滴|好呀|ok|okay|嗯+|是的?|对的?|行|可以|继续|接着|go on|continue|谢谢|多谢|thanks?|thx|收到|明白|懂了|不错|很好|完美|yes|no|不用了|没问题"
    r"|你好|您好|hi|hello|hey|在吗|早上好|下午好|晚上好)[!！。.~～\s]*$",
    re.I,
)
CORRECTION_CUE = re.compile(
    r"(太长|太短|太多|太少|啰嗦|简洁|简短|精简|短一?点|长一?点|详细一?点|具体一?点|不要|不用|别再|别用|别|少用|多用|中文|英文|先说|先给|结论|直接|不对|错了|不是这样|重新|再改|改成|换成|换个|控制在|不超过|以内|格式|表格|分点|列表|口语|正式|语气|记住|以后|每次|总是|一直|记得|注意|套话|废话|emoji|表情)"
    r"|\b(too long|shorter|concise|don't|do not|stop|instead|in chinese|in english|always|never|remember)\b",
    re.I,
)
TASK_START = re.compile(
    r"^(帮我|帮忙|麻烦|请|给我|把|将|写|生成|总结|翻译|分析|整理|改写|改成|设计|列出|列一|做一个|做个|创建|新建|优化|检查|评估|比较|对比|解释|梳理|review|write|create|generate|summari[sz]e|translate|explain|fix|refactor)",
    re.I,
)
STANDING = re.compile(r"(以后|今后|往后|每次|一直|始终|永远|默认|记住|记得|都这样|不要再|别再|from now on|always|never|remember)", re.I)
TROUBLE = re.compile(r"(报错|错误|失败|出错|崩溃|卡住|不行|没反应|bug|error|fail)", re.I)


def is_standing(text):
    """明确要求长期遵守：有"以后""每次"这类词，又像在提要求，而且不是在报问题。"""
    return len(text) <= 200 and bool(STANDING.search(text)) and bool(CORRECTION_CUE.search(text) or INSTRUCTION_CUE.search(text)) and not TROUBLE.search(text)
STRUCTURE = re.compile(r"(要求|格式|步骤|输出|角色|你是|注意|规则|约束|示例|^\s*(\d+[.、)]|[-*•])\s)", re.M)


def clean_text(text):
    text = text.replace("\r", "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def is_noise(text):
    if len(text) < 2 or ACKNOWLEDGEMENT.match(text) or re.match(r"^/[a-z]", text, re.I):
        return True
    return all(unicodedata.category(ch)[0] in "PSZN" for ch in text)


def extract_utterances(conversation):
    """返回 [{kind: task|correction, text, after, ...}]；第一句通常是任务。"""
    utterances, first_done, after_assistant, previous = [], False, False, None
    history_only = conversation.get("historyOnly", False)
    for index, message in enumerate(conversation["messages"]):
        if message["role"] == "assistant":
            after_assistant = True
            continue
        text = clean_text(message["text"])
        if is_noise(text):
            after_assistant, previous = False, None
            continue
        is_first = not first_done
        first_done = True
        base = {
            "id": "%s#%d" % (conversation["session"], index),
            "tool": conversation["tool"],
            "session": conversation["session"],
            "cwd": conversation.get("cwd", ""),
            "at": message["at"],
            "full": len(text),
            "text": text[:MAX_STORED],
            "raw": text,
            "standing": is_standing(text),
        }
        if not history_only and not is_first and after_assistant and len(text) <= 80 and CORRECTION_CUE.search(text):
            item = dict(base, kind="correction", follows=previous["text"] if previous and previous["kind"] == "task" else "")
            utterances.append(item)
            if previous and previous["kind"] == "task" and not previous.get("after"):
                previous["after"], previous["afterId"] = item["text"], item["id"]
            previous = item
        elif is_first or history_only or (len(text) >= 6 and TASK_START.search(text)):
            item = dict(base, kind="task")
            utterances.append(item)
            previous = item
        else:
            if base["standing"]:
                utterances.append(dict(base, kind="other"))
            previous = None
        after_assistant = False
    return utterances


# ---------------------------------------------------------------------------
# 相似度和分组（与 PromptBox 网页里的本地提炼同一套算法）

FILLER = re.compile(r"(帮我|帮忙|麻烦你?|请你?|给我|你|我|把|将|下面|以下|这段|这篇|这个|这些|一下|的|了|吧|呢)")


def normalize(text):
    text = unicodedata.normalize("NFKC", text).lower()
    return "".join(ch for ch in text if unicodedata.category(ch)[0] not in "PSZ")


def bigrams(text):
    clean = normalize(text)
    if len(clean) == 1:
        return {clean}
    return {clean[i : i + 2] for i in range(len(clean) - 1)}


def dice(a, b):
    if not a or not b:
        return 0.0
    small, large = (a, b) if len(a) < len(b) else (b, a)
    return 2 * sum(1 for gram in small if gram in large) / (len(a) + len(b))


def split_instruction(text):
    match = re.match(r"^([\s\S]{2,100}?)(?:[：:]\s*|\n+)([\s\S]{8,})$", text.strip())
    if match:
        return match.group(1).strip(), match.group(2).strip()
    return text.strip(), ""


def core(text):
    return FILLER.sub("", normalize(text))


def cluster(entries, average_threshold, max_threshold):
    groups, index = [], defaultdict(set)
    for entry in entries:
        grams = entry["grams"]
        if not grams:
            continue
        touched = set()
        for gram in grams:
            touched |= index[gram]
        best, best_score = -1, 0.0
        for group_id in touched:
            members = groups[group_id][-12:]
            scores = [dice(grams, member["grams"]) for member in members]
            average, top = sum(scores) / len(scores), max(scores)
            if (average >= average_threshold or top >= max_threshold) and average + top > best_score:
                best, best_score = group_id, average + top
        if best == -1:
            groups.append([entry])
            best = len(groups) - 1
        else:
            groups[best].append(entry)
        for gram in grams:
            index[gram].add(best)
    return groups


def medoid(members):
    sample = members[-40:]
    best, best_sum = sample[0], -1.0
    for candidate in sample:
        total = sum(dice(candidate["grams"], other["grams"]) for other in sample if other is not candidate)
        if total > best_sum:
            best, best_sum = candidate, total
    return best


RULE_PATTERNS = [
    ("chinese", "回答用中文", re.compile(r"(用|说|讲|改用|换成|回复|回答|输出).{0,3}中文|中文(回答|回复|输出|说|讲)")),
    ("conclusion-first", "先给结论，再给理由", re.compile(r"(先|直接)(说|给|讲|写)?(结论|结果)|结论(放|写)?(在)?(前|先|最前)|别铺垫")),
    ("concise", "回答简洁", re.compile(r"太长|太啰嗦|啰嗦|简洁|简短|精简|短一?点|废话")),
    ("no-fluff", "不用套话", re.compile(r"套话|客套|空话")),
    ("table", "对比内容用表格", re.compile(r"(用|做成|列成|整理成|改成).{0,2}表格")),
    ("no-emoji", "不用 emoji", re.compile(r"(不要|别|不用|去掉).{0,3}(emoji|表情)", re.I)),
    ("english", "回答用英文", re.compile(r"(用|说|讲|回答).{0,3}英文|in english", re.I)),
]
INSTRUCTION_CUE = re.compile(r"(控制在|不超过|以内|多用|少用|不要|别|加上|加个|分成|分为|改成|换成|先|用)")


def instruction_clauses(text):
    return [part.strip() for part in re.split(r"[，,。；;！!？?\n]", text) if part.strip() and INSTRUCTION_CUE.search(part)]


def project_name(cwd):
    """项目名取工作目录的最后一段；WorkBuddy 这类按日期新建的临时目录不算项目。"""
    name = Path(cwd).name if cwd else ""
    return "" if re.fullmatch(r"[\d_-]+", name) or re.search(r"\d{4}-\d{2}-\d{2}", name) else name


def describe(members):
    sessions = {m["session"] for m in members}
    days = {local_day(m["at"]) for m in members if m["at"]}
    tools = Counter(m["tool"] for m in members)
    projects = Counter(name for name in (project_name(m["cwd"]) for m in members) if name)
    moments = [m["at"] for m in members if m["at"]]
    return {
        "count": len(members),
        "conversations": len(sessions),
        "days": len(days),
        "tools": dict(tools.most_common()),
        "projects": dict(projects.most_common(5)),
        "firstSeen": min(moments).isoformat() if moments else None,
        "lastSeen": max(moments).isoformat() if moments else None,
    }


def sample_of(members, limit=6):
    """挑几句说法不同的原话，最新的优先。"""
    picked, seen = [], []
    for member in sorted(members, key=lambda m: m["at"] or dt.datetime.min.replace(tzinfo=dt.timezone.utc), reverse=True):
        grams = member["grams"]
        if any(dice(grams, other) > 0.9 for other in seen) and len(picked) >= 2:
            continue
        seen.append(grams)
        entry = {"text": redact(clip(member["raw"], MAX_SAMPLE)), "tool": member["tool"], "at": local_day(member["at"])}
        if member.get("after"):
            entry["after"] = redact(member["after"])
        if member.get("cwd"):
            entry["project"] = project_name(member["cwd"]) or None
            if not entry["project"]:
                del entry["project"]
        picked.append(entry)
        if len(picked) >= limit:
            break
    return picked


def members_of(members, limit=50):
    ordered = sorted(members, key=lambda m: m["at"] or dt.datetime.min.replace(tzinfo=dt.timezone.utc), reverse=True)[:limit]
    out = []
    for member in ordered:
        entry = {"text": redact(clip(member["raw"], 200)), "tool": member["tool"], "at": local_day(member["at"])}
        if member.get("after"):
            entry["after"] = redact(member["after"])
        out.append(entry)
    return out


def build_groups(utterances):
    tasks = [u for u in utterances if u["kind"] == "task"]
    corrections = [u for u in utterances if u["kind"] == "correction"]
    for u in tasks:
        u["head"], u["payload"] = split_instruction(u["text"])
        u["grams"] = bigrams(core(u["head"]))
    for u in corrections + [u for u in utterances if u["kind"] == "other"]:
        u["grams"] = bigrams(u["text"])

    task_groups = [g for g in cluster(sorted(tasks, key=lambda u: u["at"] or dt.datetime.min.replace(tzinfo=dt.timezone.utc)), 0.5, 0.62)]
    task_of = {}
    out_tasks = []
    for number, group in enumerate(sorted(task_groups, key=len, reverse=True), 1):
        for member in group:
            task_of[member["id"]] = number
        info = describe(group)
        if info["count"] < TASK_MIN or info["conversations"] < 2:
            continue
        center = medoid(group)
        afters = Counter()
        for member in group:
            for clause in instruction_clauses(member.get("after", "")):
                afters[clause] += 1
        out_tasks.append(
            dict(
                info,
                id="T%d" % number,
                center=redact(clip(center["head"], 120)),
                withMaterial=sum(1 for m in group if m["payload"]),
                followUps=[{"text": redact(text), "count": count, "general": any(p.search(text) for _, _, p in RULE_PATTERNS)} for text, count in afters.most_common(6)],
                samples=sample_of(group),
                members=members_of(group),
            )
        )

    out_corrections = []
    by_pattern, leftovers = defaultdict(list), []
    for correction in corrections:
        matched = [pattern_id for pattern_id, _, pattern in RULE_PATTERNS if pattern.search(correction["text"])]
        for pattern_id in matched:
            by_pattern[pattern_id].append(correction)
        if not matched:
            leftovers.append(correction)
    for pattern_id, title, _ in RULE_PATTERNS:
        if by_pattern.get(pattern_id):
            out_corrections.append(("C-" + pattern_id, title, by_pattern[pattern_id]))
    for number, group in enumerate(cluster(leftovers, 0.55, 0.7), 1):
        out_corrections.append(("C%d" % number, clip(medoid(group)["text"], 40), group))

    # 每个对话里的任务按时间排好，用来查一句纠正跟在哪类任务后面
    tasks_by_session = defaultdict(list)
    for task in tasks:
        tasks_by_session[task["session"]].append(task)
    for session_tasks in tasks_by_session.values():
        session_tasks.sort(key=lambda u: u["at"] or dt.datetime.min.replace(tzinfo=dt.timezone.utc))

    def task_before(correction):
        previous = None
        for task in tasks_by_session.get(correction["session"], []):
            if task["at"] and correction["at"] and task["at"] > correction["at"]:
                break
            previous = task
        return previous

    correction_groups = []
    for group_id, label, members in out_corrections:
        info = describe(members)
        if info["count"] < CORRECTION_MIN or info["conversations"] < 2:
            continue
        followed = {task_of.get(task["id"]) for task in map(task_before, members) if task}
        correction_groups.append(dict(info, id=group_id, label=label, followsTaskKinds=len(followed), samples=sample_of(members), members=members_of(members)))

    standing_entries = [dict(u) for u in utterances if u.get("standing")]
    standing_groups = []
    for number, group in enumerate(cluster(standing_entries, 0.6, 0.8), 1):
        info = describe(group)
        standing_groups.append(dict(info, id="S%d" % number, samples=sample_of(group, limit=4), members=members_of(group, limit=20)))
    standing_groups.sort(key=lambda g: (-g["count"], g["id"]))

    grouped_ids = {m["id"] for g in task_groups if len(g) >= TASK_MIN for m in g}
    singles = []
    for task in tasks:
        if task["id"] in grouped_ids or task["full"] < 150:
            continue
        structure = len(STRUCTURE.findall(task["raw"]))
        specifics = len(re.findall(r"https?://|[\w./-]+\.(?:ts|tsx|js|py|md|json|go|rs|java|css|html)\b|[A-Za-z_]+\(|Error|Exception|\d{3,}", task["raw"]))
        if structure < 3 or specifics > 3:
            continue
        singles.append({"id": "L%d" % (len(singles) + 1), "structure": structure, "tool": task["tool"], "at": local_day(task["at"]), "project": project_name(task["cwd"]), "text": redact(clip(task["raw"], MAX_SINGLE))})
    singles.sort(key=lambda s: -s["structure"])

    return {"tasks": out_tasks, "corrections": correction_groups, "standing": standing_groups, "singles": singles[:20]}


# ---------------------------------------------------------------------------
# extract


def collect_conversations(args, summary):
    base = home(args)
    wanted = set(args.sources.split(",")) if args.sources else None
    conversations = []
    for tool, info in source_table(base).items():
        if wanted and tool not in wanted:
            continue
        stats = summary["tools"].setdefault(tool, {"files": 0, "conversations": 0, "skippedCompressed": 0, "unreadable": 0})
        for path in info["files"]():
            stats["files"] += 1
            text = read_file(path)
            if text is None:
                stats["skippedCompressed" if path.name.endswith(".zst") else "unreadable"] += 1
                continue
            key = "%s:%s" % (tool, path.name)
            if tool == "codex":
                parsed = parse_codex(text, key)
            elif tool == "claude-code":
                parsed = parse_claude_code(text, key)
            else:
                parsed = parse_auto(text, key, tool)
            if parsed:
                conversations.append(parsed)
                stats["conversations"] += 1
        history = info.get("history")
        if history and history.exists():
            text = read_file(history) or ""
            history_sessions = parse_history(text, "%s-history" % tool, tool)
            stats["historySessions"] = len(history_sessions)
            conversations.extend(history_sessions)
    for path in args.export or []:
        text = read_file(Path(path).expanduser())
        parsed = parse_web_export(text or "")
        for conversation in parsed:
            stats = summary["tools"].setdefault(conversation["tool"], {"files": 0, "conversations": 0})
            stats["conversations"] += 1
        conversations.extend(parsed)
    for path in args.extra or []:
        parsed = parse_extra(read_file(Path(path).expanduser()) or "")
        for conversation in parsed:
            stats = summary["tools"].setdefault(conversation["tool"], {"files": 0, "conversations": 0})
            stats["conversations"] += 1
        conversations.extend(parsed)
    return conversations


def dedupe_history(utterances):
    """输入历史和完整会话里同一句话只算一次（同一工具、同一分钟、同样的文字）。"""
    seen, out = set(), []
    for u in sorted(utterances, key=lambda u: 0 if "-history" not in u["session"] else 1):
        minute = u["at"].strftime("%Y%m%d%H%M") if u["at"] else ""
        key = (u["tool"].split("-history")[0], minute, normalize(u["text"])[:80])
        if key in seen:
            continue
        seen.add(key)
        out.append(u)
    return out


def cmd_extract(args):
    out = Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    since = dt.date.fromisoformat(args.since) if args.since else None
    summary = {"generatedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "tools": {}, "since": args.since}
    conversations = collect_conversations(args, summary)
    utterances = []
    user_messages = 0
    for conversation in conversations:
        user_messages += sum(1 for m in conversation["messages"] if m["role"] == "user")
        for utterance in extract_utterances(conversation):
            if since and utterance["at"] and utterance["at"].astimezone().date() < since:
                continue
            utterances.append(utterance)
    utterances = dedupe_history(utterances)
    groups = build_groups(utterances)
    moments = [u["at"] for u in utterances if u["at"]]
    summary.update(
        {
            "conversations": len(conversations),
            "userMessages": user_messages,
            "kept": dict(Counter(u["kind"] for u in utterances)),
            "from": local_day(min(moments)) if moments else None,
            "to": local_day(max(moments)) if moments else None,
            "projects": dict(Counter(name for name in (project_name(c.get("cwd", "")) for c in conversations) if name).most_common(10)),
            "projectPaths": [cwd for cwd, _ in Counter(c.get("cwd") for c in conversations if c.get("cwd")).most_common(10)],
            "groups": {kind: len(items) for kind, items in groups.items()},
        }
    )
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "groups.json").write_text(json.dumps(groups, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------------------
# show：分页查看分组，方便 Agent 一批批判断


def tools_text(tools):
    names = {"codex": "Codex", "claude-code": "Claude Code", "workbuddy": "WorkBuddy", "codebuddy": "CodeBuddy", "chatgpt": "ChatGPT", "claude-web": "Claude 网页版"}
    return "、".join("%s×%d" % (names.get(tool, tool), count) for tool, count in tools.items())


def cmd_show(args):
    groups = json.loads((Path(args.work).expanduser() / "groups.json").read_text(encoding="utf-8"))
    if args.id:
        for kind, items in groups.items():
            for item in items:
                if item["id"] == args.id:
                    print("[%s] 全部原话（最多 50 句，最新的在前）：" % args.id)
                    for member in item.get("members") or [item]:
                        line = "  - %s %s：%s" % (member.get("at", ""), member.get("tool", ""), member["text"].replace("\n", " ⏎ "))
                        if member.get("after"):
                            line += "  → 之后：" + member["after"]
                        print(line)
                    return
        print("没有找到 %s" % args.id)
        return
    kinds = ["tasks", "corrections", "standing", "singles"] if args.kind == "all" else [args.kind]
    for kind in kinds:
        items = groups.get(kind, [])
        chunk = items[args.offset : args.offset + args.limit]
        label = {"tasks": "任务", "corrections": "纠正", "standing": "明确要求", "singles": "单次长提示词"}[kind]
        if not chunk:
            print("== %s：%s\n" % (label, "没有" if not items else "已经看完了，共 %d 组" % len(items)))
            continue
        print("== %s：共 %d 组，显示第 %d–%d 组" % (label, len(items), args.offset + 1, args.offset + len(chunk)))
        for item in chunk:
            if kind == "singles":
                print("\n[%s] %s · %s%s\n%s" % (item["id"], item["tool"], item["at"], " · 项目 " + item["project"] if item["project"] else "", item["text"]))
                continue
            projects = "、".join(item["projects"]) if item.get("projects") else "无"
            print("\n[%s] %d 次 · %d 个对话 · %d 天 · %s · 项目：%s" % (item["id"], item["count"], item["conversations"], item["days"], tools_text(item["tools"]), projects))
            if kind == "tasks":
                print("  中心说法：%s（%d 次带了要处理的材料）" % (item["center"], item["withMaterial"]))
                if item["followUps"]:
                    print("  之后常补：" + " · ".join("%s ×%d%s" % (f["text"], f["count"], "（通用习惯）" if f["general"] else "") for f in item["followUps"]))
            if kind == "corrections":
                print("  归类：%s · 跟在 %d 类不同的任务后面" % (item["label"], item["followsTaskKinds"]))
            for sample in item["samples"]:
                line = "  - %s %s：%s" % (sample["at"], sample["tool"], sample["text"].replace("\n", " ⏎ "))
                if sample.get("after"):
                    line += "  → 之后：" + sample["after"]
                print(line)
        print()


# ---------------------------------------------------------------------------
# existing：已有的规则文件和 Skill，用来去重


def read_clip(path, limit=6000):
    try:
        return redact(path.read_text(encoding="utf-8", errors="replace"))[:limit]
    except OSError:
        return ""


def skill_line(skill_md):
    text = read_clip(skill_md, 3000)
    name = re.search(r"^name:\s*(.+)$", text, re.M)
    description = re.search(r"^description:\s*(.+)$", text, re.M)
    return "- %s：%s" % ((name.group(1).strip() if name else skill_md.parent.name), (description.group(1).strip() if description else ""))


def cmd_existing(args):
    base = home(args)
    work = Path(args.work).expanduser()
    parts, files = [], []
    rule_files = [base / ".codex" / "AGENTS.md", base / ".claude" / "CLAUDE.md", base / ".workbuddy" / "MEMORY.md"]
    rule_files += sorted((base / ".codebuddy" / "memery").glob("*.md")) if (base / ".codebuddy" / "memery").is_dir() else []
    # 会话里常出现的项目目录，看看里面有没有项目级的规则文件
    summary_path = work / "summary.json"
    projects = json.loads(summary_path.read_text(encoding="utf-8")).get("projectPaths", []) if summary_path.exists() else []
    projects += args.project or []
    for project in projects:
        for name in ("AGENTS.md", "CLAUDE.md"):
            rule_files.append(Path(project).expanduser() / name)
    for path in rule_files:
        if path.is_file():
            files.append(str(path))
            parts.append("## %s\n\n%s" % (path, read_clip(path)))
    skill_dirs = [base / ".claude" / "skills", base / ".codex" / "skills", base / ".workbuddy" / "skills"]
    skills = []
    for directory in skill_dirs:
        if directory.is_dir():
            for skill_md in sorted(directory.glob("*/SKILL.md")):
                line = skill_line(skill_md)
                if line not in skills:
                    skills.append(line)
    if skills:
        parts.append("## 已有的 Skill\n\n" + "\n".join(skills))
    if args.promptbox_backup:
        backup_path = Path(args.promptbox_backup).expanduser()
        try:
            backup = json.loads(backup_path.read_text(encoding="utf-8"))
            lines = ["- [%s] %s：%s" % ("规则" if item.get("type") == "rule" else "提示词", item.get("title", ""), clip(item.get("content", "").replace("\n", " "), 160)) for item in backup.get("items", []) if not item.get("deletedAt")]
            parts.append("## PromptBox 库里已有的内容\n\n" + "\n".join(lines))
            files.append(str(backup_path))
        except (OSError, ValueError):
            print("读不了 PromptBox 备份文件：%s" % backup_path, file=sys.stderr)
    (work / "existing.md").write_text("\n\n".join(parts) or "（没有找到已有的规则文件和 Skill）", encoding="utf-8")
    print(json.dumps({"ruleFiles": files, "skills": len(skills), "written": str(work / "existing.md")}, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------------------


def main(argv=None):
    parser = argparse.ArgumentParser(description="PromptBox：收集聊天记录里用户说过的话")
    parser.add_argument("--home", help="测试用：把这个目录当作用户主目录")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("scan", help="看本机有哪些记录，不读内容")

    extract = sub.add_parser("extract", help="抽取、分组")
    extract.add_argument("--out", required=True, help="工作目录")
    extract.add_argument("--sources", help="只读这些来源，逗号分隔：codex,claude-code,workbuddy,codebuddy")
    extract.add_argument("--since", help="只看这一天之后的对话，格式 2026-10-01")
    extract.add_argument("--export", action="append", help="ChatGPT 或 Claude 网页版导出的 conversations.json，可以给多个")
    extract.add_argument("--extra", action="append", help="其他工具转成统一格式的 jsonl，可以给多个")

    show = sub.add_parser("show", help="分页查看分组")
    show.add_argument("--work", required=True)
    show.add_argument("--kind", choices=["tasks", "corrections", "standing", "singles", "all"], default="all")
    show.add_argument("--offset", type=int, default=0)
    show.add_argument("--limit", type=int, default=20)
    show.add_argument("--id", help="只看这一组的全部原话，比如 T3")

    existing = sub.add_parser("existing", help="收集已有的规则文件和 Skill")
    existing.add_argument("--work", required=True)
    existing.add_argument("--project", action="append", help="项目目录，会读里面的 AGENTS.md、CLAUDE.md")
    existing.add_argument("--promptbox-backup", help="PromptBox 备份文件，用来和库里已有的内容去重")

    args = parser.parse_args(argv)
    {"scan": cmd_scan, "extract": cmd_extract, "show": cmd_show, "existing": cmd_existing}[args.command](args)


if __name__ == "__main__":
    main()
