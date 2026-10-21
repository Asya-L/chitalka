"""Создаёт sample.pdf (2 главы с оглавлением, колонтитулы, перенос слова, абзац через страницу) и scan.pdf (только картинка)."""
import os
from reportlab.lib.pagesizes import A5
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
T = os.path.dirname(os.path.abspath(__file__))
pdfmetrics.registerFont(TTFont('S', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'))
W, H = A5; L, R, TOP, BOT = 50, W - 50, H - 70, 60; LH = 15
c = canvas.Canvas(os.path.join(T, 'sample.pdf'), pagesize=A5)
c.setTitle('Zegar w mgle'); c.setAuthor('Anna Nowak')
page = [0]; y = [TOP]
def deco():
    c.setFont('S', 8); c.drawCentredString(W / 2, H - 35, 'Zegar w mgle'); c.drawCentredString(W / 2, 30, str(page[0] + 1))
def newpage():
    c.showPage(); page[0] += 1; y[0] = TOP; deco()
def line(txt, x=L, size=11):
    if y[0] < BOT: newpage()
    c.setFont('S', size); c.drawString(x, y[0], txt); y[0] -= LH
def para(lines):
    for i, t in enumerate(lines): line(t, L + (18 if i == 0 else 0))
deco()
SENT = ['Wiedźmin szedł powoli przez las, a mgła unosiła się', 'nad ścieżką. Nie wiedział jeszcze, że ktoś na niego', 'czeka przy starym zegarze na skraju wsi.']
for ch in (1, 2):
    if ch == 2: newpage()
    c.bookmarkPage('ch%d' % ch); c.addOutlineEntry('Rozdział %d' % ch, 'ch%d' % ch, level=0)
    y[0] -= 10; line('Rozdział %d' % ch, L, 16); y[0] -= 12
    for k in range(14):
        if ch == 1 and k == 0:
            para(['To była długa i bardzo spokoj-', 'na noc w małej wiosce nad rzeką.'])
        else:
            para([s if j < 2 else s.replace('wsi.', 'wsi (%d).' % k) for j, s in enumerate(SENT)])
c.save()
# скан: только картинка, без текста
from PIL import Image
im = Image.new('RGB', (600, 800), 'white'); p = os.path.join(T, 'out', 'scan.png'); os.makedirs(os.path.dirname(p), exist_ok=True); im.save(p)
c2 = canvas.Canvas(os.path.join(T, 'scan.pdf'), pagesize=A5); c2.drawImage(p, 0, 0, W, H); c2.showPage(); c2.save()
print('ok')
