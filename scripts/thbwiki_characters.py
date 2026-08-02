#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
THBWiki 角色列表爬虫

从 https://thbwiki.cc/官方角色列表 抓取所有官方角色的中文名与日文名。
该页面为单页 SSR，全部角色（约 179 个）都在同一页面内，只需一次请求。

用法示例:
    python scripts/thbwiki_characters.py                      # 输出 JSON 到 stdout
    python scripts/thbwiki_characters.py -f txt               # 输出 "中文名<TAB>日文名" 纯文本
    python scripts/thbwiki_characters.py -f txt --names zh    # 只输出中文名（每行一个）
    python scripts/thbwiki_characters.py -f txt --names ja    # 只输出日文名（每行一个）
    python scripts/thbwiki_characters.py -o characters.json   # 写入文件
    python scripts/thbwiki_characters.py --csv characters.csv # 输出 CSV

依赖: requests, beautifulsoup4
"""

import argparse
import csv
import json
import sys
from dataclasses import asdict, dataclass

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://thbwiki.cc"
CHARACTER_LIST_URL = f"{BASE_URL}/官方角色列表"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 "
        "(fumospots character-list crawler; single-page fetch)"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


@dataclass
class Character:
    """单个角色的名称信息"""

    name_zh: str          # 中文名
    name_ja: str          # 日文名
    name_en: str = ""     # 英文名/罗马字
    debut: str = ""       # 初登场作品
    nickname: str = ""    # 别名/昵称
    link: str = ""        # THBWiki 词条完整链接


def fetch_characters_list(url: str = CHARACTER_LIST_URL) -> str:
    """请求角色列表页面，返回 HTML 文本。"""
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding or "utf-8"
    return resp.text


def parse_characters(html: str) -> list[Character]:
    """从页面 HTML 中解析出所有角色。"""
    soup = BeautifulSoup(html, "html.parser")
    characters: list[Character] = []

    for item in soup.select("div.chara-item"):
        # 跳过表头行（chara-head），只取数据行
        if "chara-head" in item.get("class", []):
            continue

        cn_link = item.select_one("a.chara-cnname")
        jp_name = item.select_one("div.chara-jpname")
        en_name = item.select_one("div.chara-enname")
        first = item.select_one("div.chara-first a")
        nickname = item.select_one("div.chara-nickname")

        if cn_link is None or jp_name is None:
            continue

        characters.append(
            Character(
                name_zh=cn_link.get_text(strip=True),
                name_ja=jp_name.get_text(strip=True),
                name_en=en_name.get_text(strip=True) if en_name else "",
                debut=first.get_text(strip=True) if first else "",
                nickname=nickname.get_text(strip=True) if nickname else "",
                link=BASE_URL + cn_link.get("href", "")
                if cn_link.get("href") else "",
            )
        )

    return characters


def render_txt(characters: list[Character], names: str) -> str:
    """渲染为纯文本：默认 "中文名<TAB>日文名"，--names zh/ja 时只输出单列。"""
    lines = []
    for c in characters:
        if names == "zh":
            lines.append(c.name_zh)
        elif names == "ja":
            lines.append(c.name_ja)
        else:
            lines.append(f"{c.name_zh}\t{c.name_ja}")
    return "\n".join(lines) + "\n"


def write_csv(characters: list[Character], path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(
            f, fieldnames=["name_zh", "name_ja", "name_en", "debut", "nickname", "link"]
        )
        writer.writeheader()
        for c in characters:
            writer.writerow(asdict(c))


def main() -> int:
    parser = argparse.ArgumentParser(description="爬取 THBWiki 官方角色列表的中文名与日文名")
    parser.add_argument(
        "-f", "--format",
        choices=["json", "txt", "csv"],
        default="json",
        help="输出格式（默认 json）",
    )
    parser.add_argument(
        "--names",
        choices=["zh", "ja", "both"],
        default="both",
        help="txt 格式下输出的名称列（默认 both: 中文名<TAB>日文名）",
    )
    parser.add_argument(
        "-o", "--output",
        help="输出文件路径；不指定时输出到 stdout",
    )
    parser.add_argument(
        "--csv",
        help="同时输出 CSV 到指定路径（等价于 -f csv -o <path>）",
    )
    parser.add_argument(
        "--url",
        default=CHARACTER_LIST_URL,
        help="角色列表页 URL（默认官方角色列表；也可换成 /二次角色列表）",
    )
    args = parser.parse_args()

    # 兼容 --csv 快捷方式
    if args.csv:
        args.format = "csv"
        args.output = args.csv

    print(f"正在抓取: {args.url}", file=sys.stderr)
    html = fetch_characters_list(args.url)
    characters = parse_characters(html)
    print(f"解析到 {len(characters)} 个角色", file=sys.stderr)

    if args.format == "txt":
        text = render_txt(characters, args.names)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(text)
            print(f"已写入: {args.output}", file=sys.stderr)
        else:
            sys.stdout.write(text)
    elif args.format == "csv":
        path = args.output or "thbwiki_characters.csv"
        write_csv(characters, path)
        print(f"已写入: {path}", file=sys.stderr)
    else:  # json
        payload = json.dumps(
            [asdict(c) for c in characters],
            ensure_ascii=False,
            indent=2,
        )
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(payload + "\n")
            print(f"已写入: {args.output}", file=sys.stderr)
        else:
            print(payload)

    return 0


if __name__ == "__main__":
    sys.exit(main())
