# 一次性结构检查：标签是否配对（script/style 内容会被解析器当纯文本，不受影响）
import os
import sys
from html.parser import HTMLParser

VOID = {"meta", "link", "br", "input", "img", "hr", "source", "area", "col"}
INDEX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "index.html")


class P(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.bad = 0

    def handle_starttag(self, tag, attrs):
        if tag not in VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if not self.stack or self.stack[-1] != tag:
            print("MISMATCH </%s>，当前栈顶 %s" % (tag, self.stack[-3:]))
            self.bad += 1
            if self.stack:
                self.stack.pop()
            return
        self.stack.pop()


p = P()
p.feed(open(INDEX, encoding="utf-8").read())
print("未闭合标签:", p.stack or "无", "| 错配数:", p.bad)
sys.exit(1 if (p.bad or p.stack) else 0)
