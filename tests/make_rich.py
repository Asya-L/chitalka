"""Создаёт rich.epub и rich.fb2: курсив, жирный и иллюстрации (для кейса x06)."""
import base64, io, os, zipfile
from PIL import Image, ImageDraw
T = os.path.dirname(os.path.abspath(__file__))
def png(w, h, color):
    im = Image.new('RGB', (w, h), color); d = ImageDraw.Draw(im); d.ellipse((w // 4, h // 4, w * 3 // 4, h * 3 // 4), fill=(240, 220, 160))
    b = io.BytesIO(); im.save(b, 'PNG'); return b.getvalue()
big, icon = png(1600, 1000, (15, 76, 85)), png(20, 20, (0, 0, 0))
para = 'The clock in the hall had stopped at midnight, and nobody in the house knew why it mattered so much to her. '
ch1 = f'''<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body>
<h1>Chapter One</h1><p>She read the letter <em>very slowly</em>, and then <strong>once again</strong>.</p>
<figure><img src="../images/pic.png" alt="clock"/><figcaption>The old clock</figcaption></figure>
<p>An <i>italic <b>and bold</b></i> word, and <img src="../images/icon.png" alt=""/> a tiny icon.</p>
{''.join(f'<p>{para * 3}</p>' for _ in range(6))}
</body></html>'''
z = zipfile.ZipFile(os.path.join(T, 'rich.epub'), 'w')
z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip')
z.writestr('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
z.writestr('OEBPS/content.opf', '''<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Stopped Clock</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language></metadata>
<manifest><item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/><item id="p" href="images/pic.png" media-type="image/png"/><item id="i" href="images/icon.png" media-type="image/png"/></manifest><spine><itemref idref="c1"/></spine></package>''')
z.writestr('OEBPS/text/ch1.xhtml', ch1); z.writestr('OEBPS/images/pic.png', big); z.writestr('OEBPS/images/icon.png', icon); z.close()
fb2 = f'''<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><author><first-name>Anna</first-name><last-name>Nowak</last-name></author><book-title>Zegar</book-title><lang>pl</lang></title-info></description>
<body><section><title><p>Rozdział pierwszy</p></title>
<p>Ona czytała list <emphasis>bardzo powoli</emphasis>, a potem <strong>jeszcze raz</strong>.</p>
<image l:href="#pic.png"/>
{''.join('<p>Zegar w korytarzu zatrzymał się o północy i nikt w domu nie wiedział, dlaczego to było dla niej tak ważne. Zegar w korytarzu zatrzymał się o północy.</p>' for _ in range(8))}
</section></body>
<binary id="pic.png" content-type="image/png">{base64.b64encode(big).decode()}</binary></FictionBook>'''
open(os.path.join(T, 'rich.fb2'), 'w', encoding='utf-8').write(fb2)
print('ok')
