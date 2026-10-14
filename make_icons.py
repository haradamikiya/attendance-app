"""アイコン生成スクリプト（再生成したいときだけ: python3 make_icons.py）"""
from PIL import Image, ImageDraw

BLUE = (29, 78, 216)
WHITE = (255, 255, 255)

def draw(size, scale=1.0):
    S = 1024
    img = Image.new("RGB", (S, S), BLUE)
    d = ImageDraw.Draw(img)
    c = S / 2
    def rr(x0, y0, x1, y1, r):
        # scale around the center
        f = lambda v: c + (v - c) * scale
        d.rounded_rectangle([f(x0), f(y0), f(x1), f(y1)], radius=r * scale, fill=WHITE)
    rr(130, 478, 894, 546, 34)      # bar
    rr(230, 300, 322, 724, 36)      # inner plate L
    rr(130, 370, 206, 654, 30)      # outer plate L
    rr(702, 300, 794, 724, 36)      # inner plate R
    rr(818, 370, 894, 654, 30)      # outer plate R
    return img.resize((size, size), Image.LANCZOS)

draw(512).save("icons/icon-512.png")
draw(192).save("icons/icon-192.png")
draw(180).save("icons/apple-touch-icon.png")
draw(512, 0.8).save("icons/maskable-512.png")
