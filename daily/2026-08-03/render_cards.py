from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageEnhance

ROOT = Path(__file__).resolve().parent
BG = ROOT / "backgrounds"
OUT = ROOT / "final"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 1080, 1440
GREEN = "#183d32"
IVORY = "#f4f0e8"
RED = "#a4472f"
FONT = r"C:\Windows\Fonts\msyh.ttc"
BOLD = r"C:\Windows\Fonts\msyhbd.ttc"

def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else FONT, size)

def fit_background(index):
    im = Image.open(BG / f"{index:02d}-background.png").convert("RGB")
    scale = max(W / im.width, H / im.height)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.LANCZOS)
    left = (im.width - W) // 2
    top = (im.height - H) // 2
    return im.crop((left, top, left + W, top + H))

def shadow_panel(im, box, fill, alpha=225, radius=24):
    overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(overlay).rounded_rectangle(box, radius=radius, fill=fill + f"{alpha:02x}")
    return Image.alpha_composite(im.convert("RGBA"), overlay)

def text(draw, xy, value, size, color, bold=False, anchor=None, spacing=12):
    draw.multiline_text(xy, value, font=font(size, bold), fill=color, anchor=anchor, spacing=spacing)

def save(im, index, slug):
    path = OUT / f"{index:02d}-{slug}.png"
    im.convert("RGB").save(path, quality=95)
    return path

# 1 Cover
im = ImageEnhance.Contrast(fit_background(1)).enhance(0.96)
im = shadow_panel(im, (70, 95, 940, 650), IVORY, 226)
d = ImageDraw.Draw(im)
text(d, (115, 165), "她把罪案\n写得如此安静", 92, GREEN, True, spacing=24)
d.line((116, 430, 290, 430), fill=RED, width=6)
text(d, (118, 475), "P. D. 詹姆斯", 42, GREEN)
text(d, (118, 550), "HERLIT · 08 / 03", 25, RED, True)
save(im, 1, "cover")

# 2 Writing
im = shadow_panel(fit_background(2), (70, 130, 830, 390), GREEN, 226)
d = ImageDraw.Draw(im)
text(d, (112, 185), "在一天正式开始以前，\n她先写一小时", 58, IVORY, True, spacing=22)
d.line((114, 337, 260, 337), fill=RED, width=5)
save(im, 2, "writing")

# 3 Timeline
im = shadow_panel(fit_background(3), (70, 90, 1010, 1350), IVORY, 238)
d = ImageDraw.Draw(im)
text(d, (112, 135), "她的职业路径", 58, GREEN, True)
d.line((145, 310, 145, 1040), fill=GREEN, width=4)
items = [(330, "1920", "生于牛津"), (610, "1949", "进入医疗系统"), (890, "1968", "转入内政部")]
for y, year, label in items:
    d.ellipse((128, y-17, 162, y+17), fill=RED)
    text(d, (205, y-48), year, 54, RED, True)
    text(d, (205, y+25), label, 43, GREEN)
d.line((112, 1135, 930, 1135), fill=RED, width=3)
text(d, (112, 1185), "近四十岁开始写第一部长篇", 40, GREEN, True)
save(im, 3, "timeline")

# 4 Books
im = shadow_panel(fit_background(4), (55, 60, 1025, 1380), IVORY, 235)
d = ImageDraw.Draw(im)
text(d, (95, 100), "三条阅读路径", 55, GREEN, True)
books = [
    (310, "《掩上她的脸》", "1962", "封闭宅邸"),
    (660, "《一份不适合女人的工作》", "1972", "女性侦探"),
    (1010, "《人类之子》", "1992", "失去未来"),
]
for y, title, year, key in books:
    text(d, (95, y), title, 45 if len(title) < 10 else 39, GREEN, True)
    text(d, (95, y+78), year, 35, RED, True)
    text(d, (310, y+78), key, 35, GREEN)
    d.line((95, y+145, 950, y+145), fill=GREEN, width=2)
save(im, 4, "books")

# 5 Reading paths
im = shadow_panel(fit_background(5), (55, 55, 1025, 1385), GREEN, 224)
d = ImageDraw.Draw(im)
text(d, (95, 105), "从哪一本开始？", 58, IVORY, True)
routes = [
    (330, "想读古典谜案", "→《掩上她的脸》"),
    (595, "想读女性侦探", "→《一份不适合女人的工作》"),
    (860, "想读社会寓言", "→《人类之子》"),
]
for y, lead, title_ in routes:
    text(d, (100, y), lead, 35, IVORY)
    text(d, (100, y+65), title_, 41 if len(title_) < 11 else 35, IVORY, True)
    d.line((100, y+135, 930, y+135), fill=RED, width=3)
text(d, (540, 1225), "你更在意谜底，\n还是谜底背后的人？", 42, IVORY, True, anchor="mm", spacing=16)
save(im, 5, "reading-path")

print("\n".join(str(p) for p in sorted(OUT.glob("*.png"))))
