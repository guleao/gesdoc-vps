import os, sys, time
import static_ffmpeg
static_ffmpeg.add_paths()
from playwright.sync_api import sync_playwright
from playwright_recaptcha import recaptchav2

CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
BASE = 'https://newcontract.contractweb.com.br'

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME, headless=False)
    page = browser.new_page(locale='en-US')
    page.goto(BASE + '/Home', wait_until='domcontentloaded')
    page.wait_for_selector('#password', timeout=30000)
    page.fill('#Login', os.environ.get('BERNHOEFT_USER', ''))
    page.fill('#password', os.environ.get('BERNHOEFT_PASSWORD', ''))
    t = time.time()
    try:
        with recaptchav2.SyncSolver(page) as solver:
            token = solver.solve_recaptcha(wait=True, image_challenge=False)
        print('CAPTCHA OK token len', len(token), 'em', round(time.time() - t, 1), 's')
    except Exception as e:
        print('CAPTCHA FALHOU:', type(e).__name__, str(e)[:100])
        page.screenshot(path='out/captcha_portal_fail.png')
        browser.close()
        sys.exit(1)
    page.click('#BotaoLogin')
    page.wait_for_timeout(8000)
    print('URL apos login:', page.url)
    print('senha ainda visivel:', page.query_selector('#password') is not None)
    page.screenshot(path='out/captcha_portal_pos_login.png')
    browser.close()
