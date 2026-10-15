import sys, time
import static_ffmpeg
static_ffmpeg.add_paths()
from playwright.sync_api import sync_playwright
from playwright_recaptcha import recaptchav2

CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
URL = sys.argv[1] if len(sys.argv) > 1 else 'https://www.google.com/recaptcha/api2/demo'

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME, headless=False)
    page = browser.new_page(locale='en-US')
    page.goto(URL)
    t = time.time()
    try:
        with recaptchav2.SyncSolver(page) as solver:
            token = solver.solve_recaptcha(wait=True, image_challenge=False)
        print('OK token len', len(token), 'em', round(time.time() - t, 1), 's')
    except Exception as e:
        print('FALHOU:', type(e).__name__, str(e)[:80])
        for f in page.frames:
            if 'bframe' in f.url:
                print('BFRAME:', f.inner_text('body')[:300].replace(chr(10),' | '))
        page.screenshot(path='out/captcha_fail.png')
    browser.close()


