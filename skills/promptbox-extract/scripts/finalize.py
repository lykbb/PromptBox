#!/usr/bin/env python3
"""检查 Agent 写好的候选草稿，补全格式、隐藏隐私、合并重复，写出 PromptBox 能导入的候选文件。

python3 finalize.py 草稿.json --work 工作目录 --out ~/Downloads/promptbox-candidates-2026-10-16.json

有「错误」时不写文件，改好草稿再运行；只有「提醒」时照常写出，但要逐条看一遍。
"""

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from collect import bigrams, dice, normalize, redact  # noqa: E402

TYPES = {"prompt", "rule"}
SCOPES = {"global", "project", "task"}
CONFIDENCE = {"high", "medium"}
TOOLS = {"codex", "claude-code", "workbuddy", "codebuddy", "chatgpt", "claude-web", "gemini", "cursor", "copilot", "cline", "opencode", "other"}
RULE_CATEGORIES = {"语言", "篇幅", "格式和结构", "语气和风格", "工作流程", "代码规范", "工具和环境", "安全和隐私"}
EXPORTS = {"md", "skill", "agents", "claude"}
VARIABLE = re.compile(r"\{\{([^{}\n]*)\}\}")
SPECIFICS = re.compile(r"https?://\S+|(?:[\w-]+/)+[\w.-]+\.\w{1,5}\b|\b\w+(?:Error|Exception)\b|\b(?:TypeError|undefined|null)\b")
MAX_CANDIDATES_HINT = 50


def text(value):
    return value.strip() if isinstance(value, str) else ""


def check_candidate(raw, number, errors, notes):
    where = "第 %d 条" % number
    if not isinstance(raw, dict):
        errors.append("%s 不是一个对象" % where)
        return None
    title = text(raw.get("title"))
    where = "第 %d 条「%s」" % (number, title or "未命名")
    kind = raw.get("type")
    content = text(raw.get("content"))
    reason = text(raw.get("reason"))
    if kind not in TYPES:
        errors.append("%s：type 只能是 prompt 或 rule" % where)
    if not title:
        errors.append("%s：缺少名称 title" % where)
    elif len(title) > 24:
        notes.append("%s：名称超过 24 个字，已截短" % where)
        title = title[:24]
    if not content:
        errors.append("%s：缺少内容 content" % where)
    if not reason:
        errors.append("%s：缺少理由 reason，说清为什么值得存" % where)
    confidence = raw.get("confidence")
    if confidence not in CONFIDENCE:
        notes.append("%s：置信度不是 high 或 medium，按标准不收，已去掉" % where)
        return None

    cleaned = redact(content)
    if cleaned != content:
        notes.append("%s：内容里有像密钥、邮箱、手机号的文字，已换成 [已隐藏]，请确认模板还通顺" % where)
    content = cleaned
    for name in VARIABLE.findall(content):
        if not name.strip() or len(name.strip()) > 20:
            errors.append("%s：变量 {{%s}} 的名字要 1–20 个字" % (where, name))
    if kind == "prompt":
        leftover = SPECIFICS.findall(content)
        if leftover:
            notes.append("%s：模板里可能残留具体信息（%s），确认是否应该换成变量或删掉" % (where, "、".join(sorted(set(leftover))[:3])))

    # 提示词不分适用范围；规则必须写清楚是所有任务、某个项目还是某类任务
    scope = raw.get("scope")
    if kind == "prompt":
        if scope not in (None, "global"):
            notes.append("%s：提示词不分适用范围，已按所有任务处理" % where)
        scope = "global"
    elif not isinstance(scope, str) or scope not in SCOPES:
        errors.append("%s：规则必须明确填写 scope（global、project、task），不能默认适用于所有任务" % where)
        return None
    candidate = {
        "type": kind,
        "title": title,
        "content": content,
        "tags": [text(tag) for tag in raw.get("tags") or [] if text(tag)][:2],
        "scope": scope,
        "reason": redact(reason),
        "confidence": confidence,
    }
    if scope == "project":
        if not text(raw.get("project")):
            errors.append("%s：适用范围是项目，必须填写项目名或完整路径" % where)
        candidate["project"] = text(raw.get("project"))
    if scope == "task":
        candidate["taskType"] = text(raw.get("taskType"))
        if not candidate["taskType"]:
            errors.append("%s：适用范围是任务，必须填写 taskType" % where)
    if kind == "rule":
        category = text(raw.get("ruleCategory"))
        if category and category not in RULE_CATEGORIES:
            notes.append("%s：规则类别「%s」不在列表里，已去掉" % (where, category))
            category = ""
        if category:
            candidate["ruleCategory"] = category

    for field in ("count", "conversations", "days"):
        value = raw.get(field)
        candidate[field] = int(value) if isinstance(value, (int, float)) and value >= 1 else 1
    if kind == "prompt" and confidence == "high" and candidate["count"] < 5 and "明确" not in reason:
        notes.append("%s：只重复了 %d 次，按标准置信度应该是 medium" % (where, candidate["count"]))
    tools = [tool for tool in raw.get("tools") or [] if isinstance(tool, str)]
    candidate["tools"] = [tool if tool in TOOLS else "other" for tool in tools] or ["other"]
    for field in ("firstSeen", "lastSeen"):
        if text(raw.get(field)):
            candidate[field] = text(raw.get(field))
    fixes = [redact(text(fix)) for fix in raw.get("fixes") or [] if text(fix)]
    if fixes:
        candidate["fixes"] = fixes

    quotes = []
    for quote in (raw.get("quotes") or [])[:5]:
        if not isinstance(quote, dict) or not text(quote.get("text")):
            continue
        entry = {"tool": quote.get("tool") if quote.get("tool") in TOOLS else "other", "at": text(quote.get("at")), "text": redact(text(quote["text"]))[:120]}
        if text(quote.get("after")):
            entry["after"] = redact(text(quote["after"]))[:120]
        quotes.append(entry)
    if not quotes:
        errors.append("%s：至少要有 1 句原话证据 quotes" % where)
    candidate["quotes"] = quotes

    export = raw.get("export") if isinstance(raw.get("export"), dict) else {}
    export_format = export.get("format") if export.get("format") in EXPORTS else ("agents" if kind == "rule" else "md")
    candidate["export"] = {"format": export_format}
    if export_format == "skill":
        name = text(export.get("skillName"))
        description = text(export.get("skillDescription"))
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name) or len(name) > 64 or re.search(r"anthropic|claude", name):
            notes.append("%s：Skill 短名不合规（小写字母、数字、连字符，最长 64，不能含 anthropic、claude），已改成导出 .md" % where)
            candidate["export"] = {"format": "md"}
        elif not description or len(description) > 1024 or re.search(r"<[^>]+>", description):
            notes.append("%s：Skill 描述要非空、1024 字以内、不含标签，已改成导出 .md" % where)
            candidate["export"] = {"format": "md"}
        else:
            candidate["export"].update({"skillName": name, "skillDescription": description})
    return candidate


def scope_key(candidate):
    scope = candidate.get("scope")
    detail = candidate.get("project", "") if scope == "project" else candidate.get("taskType", "") if scope == "task" else ""
    return scope, detail.strip()


def merge_duplicates(candidates, notes):
    kept = []
    for candidate in candidates:
        grams = bigrams(candidate["content"])
        twin = next(
            (other for other in kept if other["type"] == candidate["type"] and scope_key(other) == scope_key(candidate) and (other["title"] == candidate["title"] or dice(grams, bigrams(other["content"])) >= 0.8)),
            None,
        )
        if twin:
            notes.append("「%s」和「%s」内容几乎一样，合并成一条" % (candidate["title"], twin["title"]))
            if candidate["count"] > twin["count"]:
                kept[kept.index(twin)] = candidate
            continue
        kept.append(candidate)
    return kept


def check_existing(candidates, work, notes):
    path = work / "existing.md" if work else None
    if not path or not path.exists():
        return
    lines = [line.strip("-* \t") for line in path.read_text(encoding="utf-8").splitlines() if len(line.strip()) >= 4]
    for candidate in candidates:
        target = normalize(candidate["content"])
        grams = bigrams(candidate["content"])
        for line in lines:
            if (len(target) >= 4 and target in normalize(line)) or dice(grams, bigrams(line)) >= 0.7:
                notes.append("「%s」可能已经写在已有的规则或库里：%s" % (candidate["title"], line[:60]))
                break


def main(argv=None):
    parser = argparse.ArgumentParser(description="检查候选草稿，写出 PromptBox 候选文件")
    parser.add_argument("draft", help="Agent 写的草稿 JSON")
    parser.add_argument("--out", required=True, help="输出的候选文件路径")
    parser.add_argument("--work", help="collect.py 的工作目录，用来带上扫描概况、检查是否已有")
    args = parser.parse_args(argv)

    try:
        draft = json.loads(Path(args.draft).expanduser().read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print("错误：读不了草稿：%s" % error)
        return 1
    raw_candidates = draft if isinstance(draft, list) else draft.get("candidates") if isinstance(draft, dict) else None
    if not isinstance(raw_candidates, list):
        print("错误：草稿里要有 candidates 列表")
        return 1

    errors, notes = [], []
    candidates = [c for c in (check_candidate(raw, i, errors, notes) for i, raw in enumerate(raw_candidates, 1)) if c]
    candidates = merge_duplicates(candidates, notes)
    work = Path(args.work).expanduser() if args.work else None
    check_existing(candidates, work, notes)
    if len(candidates) > MAX_CANDIDATES_HINT:
        notes.append("一共 %d 条，超过 %d 条，多半收得太松，再按标准筛一遍" % (len(candidates), MAX_CANDIDATES_HINT))

    if errors:
        print("错误（要先改好草稿，这次没有写文件）：")
        for error in errors:
            print("  - " + error)
        if notes:
            print("提醒：")
            for note in notes:
                print("  - " + note)
        return 1

    scanned = {}
    if work and (work / "summary.json").exists():
        summary = json.loads((work / "summary.json").read_text(encoding="utf-8"))
        scanned = {
            "tools": sorted(tool for tool, stats in summary.get("tools", {}).items() if stats.get("conversations")),
            "conversations": summary.get("conversations"),
            "userMessages": summary.get("userMessages"),
            "from": summary.get("from"),
            "to": summary.get("to"),
            "skippedCompressed": sum(stats.get("skippedCompressed", 0) for stats in summary.get("tools", {}).values()),
        }
    output = {
        "app": "promptbox",
        "kind": "candidates",
        "formatVersion": 1,
        "generatedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "generator": "promptbox-extract",
        "scanned": scanned,
        "candidates": candidates,
    }
    out = Path(args.out).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

    prompts = [c for c in candidates if c["type"] == "prompt"]
    rules = [c for c in candidates if c["type"] == "rule"]
    print("已写出：%s" % out)
    print("提示词 %d 条，规则 %d 条" % (len(prompts), len(rules)))
    for candidate in candidates:
        print("  - [%s] %s · %s · %s" % ("提示词" if candidate["type"] == "prompt" else "规则", candidate["title"], candidate["confidence"], candidate["reason"]))
    if notes:
        print("提醒（逐条看一遍，需要的话改草稿再运行）：")
        for note in notes:
            print("  - " + note)
    return 0


if __name__ == "__main__":
    sys.exit(main())
