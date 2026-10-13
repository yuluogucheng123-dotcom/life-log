"""生成「学习专题」总入口图标：深色底 + 层叠卡片 + 书签角标。"""
from PIL import Image, ImageDraw

BG = (15, 17, 21)
ACCENT = (79, 140, 255)
GREEN = (46, 204, 155)
WARN = (255, 176, 32)
PURPLE = (167, 139, 250)
WHITE = (238, 241, 246)


def make_icon(size, path, maskable=False):
    s = size * 4  # 4x 超采样
    img = Image.new("RGBA", (s, s), BG + (255,))
    d = ImageDraw.Draw(img)

    if maskable:
        pad = s * 0.26
    else:
        pad = s * 0.19

    # 三张层叠卡片（后面两张偏移，形成层次）
    cw = s - pad * 2
    ch = cw * 0.60
    cx0 = pad
    cy0 = (s - ch) / 2
    r = cw * 0.075

    # 底层
    off = cw * 0.055
    d.rounded_rectangle(
        [cx0 + off * 2, cy0 - off * 2 * 0.4, cx0 + cw + off * 2 * 0.0, cy0 + ch - off * 1.2],
        radius=r, fill=(38, 44, 56, 255),
    )
    # 中层
    d.rounded_rectangle(
        [cx0 + off, cy0 - off * 0.2, cx0 + cw + off * 0.0, cy0 + ch - off * 0.6],
        radius=r, fill=(52, 60, 76, 255),
    )
    # 顶层（主卡片）
    d.rounded_rectangle([cx0, cy0, cx0 + cw, cy0 + ch], radius=r, fill=WHITE + (255,))

    # 卡片上的三条内容线，用不同强调色
    line_h = ch * 0.105
    gap = ch * 0.115
    ly = cy0 + ch * 0.20
    colors = [ACCENT, GREEN, WARN]
    widths = [0.56, 0.68, 0.42]
    for i, (wf, col) in enumerate(zip(widths, colors)):
        # 左侧小色块
        sq = line_h * 1.0
        d.rounded_rectangle(
            [cx0 + cw * 0.085, ly, cx0 + cw * 0.085 + sq, ly + sq],
            radius=sq * 0.30, fill=col + (255,),
        )
        # 右侧线条
        lx = cx0 + cw * 0.085 + sq + cw * 0.055
        lw = cw * wf - sq - cw * 0.055
        d.rounded_rectangle(
            [lx, ly + sq * 0.18, lx + lw, ly + sq * 0.82],
            radius=line_h * 0.32, fill=(150, 158, 172, 255),
        )
        ly += line_h + gap

    img = img.resize((size, size), Image.LANCZOS)
    img.save(path, "PNG")
    return path


if __name__ == "__main__":
    make_icon(192, "icons/icon-192.png")
    make_icon(512, "icons/icon-512.png")
    make_icon(512, "icons/icon-maskable-512.png", maskable=True)
    make_icon(180, "icons/apple-touch-icon.png")  # iOS 主屏
    print("hub icons generated")
