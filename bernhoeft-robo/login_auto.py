"""Login automático no Bernhoeft: resolve o reCAPTCHA v2 e salva a sessão em profile/.
Chamado pelo pendencias.js quando a sessão expira (ou direto: python login_auto.py).

Resolução, em cada tentativa (se um falhar, passa para o próximo):
  1) primeiro, áudio grátis (playwright-recaptcha). CAPTCHA_AUDIO=0 desliga. Se as bibliotecas do áudio
     não estiverem instaladas, ele é desligado sozinho;
  2) se o áudio falhar, serviços pagos que tiverem chave em variável de ambiente, na ordem de CAPTCHA_FALLBACK
     (padrão: 2captcha,anticaptcha,capmonster,capsolver). Sem chave, o serviço é pulado. Chave inválida ou
     sem saldo tira o serviço das próximas tentativas.

Códigos de saída: 0 = logado (ou já estava), 3 = não conseguiu (usar login manual: node login.js).
Variáveis: BERNHOEFT_USER, BERNHOEFT_PASSWORD, BERNHOEFT_URL, PROFILE_DIR, CHROME_PATH, HEADLESS=1, TENTATIVAS,
CAPTCHA_FALLBACK, CAPTCHA_AUDIO, TWOCAPTCHA_API_KEY, ANTICAPTCHA_API_KEY, CAPMONSTER_API_KEY, CAPSOLVER_API_KEY."""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ.get('BERNHOEFT_URL', 'https://newcontract.contractweb.com.br')
PROFILE = os.environ.get('PROFILE_DIR', os.path.join(HERE, 'profile'))
CHROME = os.environ.get('CHROME_PATH') or (
    r'C:\Program Files\Google\Chrome\Application\chrome.exe' if sys.platform == 'win32' else None)
HEADLESS = os.environ.get('HEADLESS') == '1'
TENTATIVAS = int(os.environ.get('TENTATIVAS', '4'))
AUDIO = os.environ.get('CAPTCHA_AUDIO', '1') != '0'
# Erros que não se resolvem tentando de novo: o serviço sai da fila até a próxima execução.
ERROS_DEFINITIVOS = ('KEY_DOES_NOT_EXIST', 'WRONG_USER_KEY', 'KEY_DENIED_ACCESS', 'ZERO_BALANCE', 'NO_SLOT_AVAILABLE_ZERO')

# Os quatro serviços falam o mesmo protocolo (createTask / getTaskResult); só mudam o endereço, o nome do tipo e a chave.
SERVICOS = {
    '2captcha': {'url': 'https://api.2captcha.com', 'tipo': 'RecaptchaV2TaskProxyless', 'chave': 'TWOCAPTCHA_API_KEY'},
    'anticaptcha': {'url': 'https://api.anti-captcha.com', 'tipo': 'RecaptchaV2TaskProxyless', 'chave': 'ANTICAPTCHA_API_KEY'},
    'capmonster': {'url': 'https://api.capmonster.cloud', 'tipo': 'RecaptchaV2Task', 'chave': 'CAPMONSTER_API_KEY'},
    'capsolver': {'url': 'https://api.capsolver.com', 'tipo': 'ReCaptchaV2TaskProxyLess', 'chave': 'CAPSOLVER_API_KEY'},
}
ORDEM = [s.strip().lower() for s in os.environ.get('CAPTCHA_FALLBACK', '2captcha,anticaptcha,capmonster,capsolver').split(',') if s.strip()]


def log(msg):
    print(f'[login_auto {time.strftime("%H:%M:%S")}] {msg}', flush=True)


def _post(url, corpo):
    req = urllib.request.Request(url, data=json.dumps(corpo).encode(), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:  # alguns serviços (CapSolver) devolvem o erro da chave com HTTP 401
        try:
            return json.loads(e.read().decode())
        except ValueError:
            raise e


def _erro(r):
    # o CapSolver repete um trecho da chave (CAP-...) na descrição; não deixar isso ir para o log
    desc = re.sub(r'CAP-[0-9A-Za-z]+', 'CAP-***', r.get('errorDescription') or '')
    return f"{r.get('errorCode')}: {desc[:80]}"


def resolver_com_servico(nome, sitekey, url_pagina, limite=150):
    """Devolve o token do reCAPTCHA resolvido pelo serviço (levanta exceção se falhar)."""
    cfg = SERVICOS[nome]
    chave = os.environ.get(cfg['chave'], '').strip()
    r = _post(cfg['url'] + '/createTask', {
        'clientKey': chave,
        'task': {'type': cfg['tipo'], 'websiteURL': url_pagina, 'websiteKey': sitekey},
    })
    if r.get('errorId'):
        raise RuntimeError(_erro(r))
    inicio = time.time()
    while time.time() - inicio < limite:
        time.sleep(4)
        g = _post(cfg['url'] + '/getTaskResult', {'clientKey': chave, 'taskId': r['taskId']})
        if g.get('errorId'):
            raise RuntimeError(_erro(g))
        if g.get('status') == 'ready':
            return g['solution']['gRecaptchaResponse']
    raise TimeoutError(f'{nome}: sem resposta em {limite}s')


def achar_sitekey(page):
    return page.evaluate("""() => {
        const el = document.querySelector('[data-sitekey]');
        if (el) return el.getAttribute('data-sitekey');
        const f = Array.from(document.querySelectorAll('iframe[src*="recaptcha"]')).map(x => x.src).find(s => /[?&]k=/.test(s));
        return f ? new URL(f).searchParams.get('k') : null;
    }""")


def injetar_token(page, token):
    """Coloca o token no campo do formulário (e chama o callback do reCAPTCHA, se houver)."""
    page.evaluate("""(t) => {
        document.querySelectorAll('textarea[name="g-recaptcha-response"], #g-recaptcha-response').forEach(a => {
            a.value = t; a.innerHTML = t; a.style.display = 'block';
        });
        try {
            const cfg = window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients;
            if (cfg) Object.values(cfg).forEach(c => JSON.stringify(c, (k, v) => {
                if (v && typeof v === 'object' && typeof v.callback === 'function') v.callback(t);
                return typeof v === 'function' ? undefined : v;
            }));
        } catch (e) {}
    }""", token)


def servicos_disponiveis():
    return [n for n in ORDEM if n in SERVICOS and os.environ.get(SERVICOS[n]['chave'], '').strip()]


def preencher(page, user, senha):
    # Desde 24/10 o login é em duas etapas: Login → "Continuar" → aparecem senha, reCAPTCHA e o botão Login.
    page.fill('#Login', user)
    if page.is_visible('#BotaoContinuar'):
        page.click('#BotaoContinuar')
    page.wait_for_selector('#password', state='visible', timeout=30000)
    page.fill('#password', senha)


def entrou(page, espera=20000):
    try:
        page.wait_for_selector('#password', state='detached', timeout=espera)
        return True
    except Exception:
        return False


def finalizar(page):
    page.wait_for_load_state('networkidle')
    try:  # banner de cookies de perfil novo cobre a tela e bloqueia cliques do pendencias.js
        page.get_by_text('Entendi', exact=True).click(timeout=5000)
    except Exception:
        pass
    log('Login feito; sessão salva em ' + PROFILE)


def main():
    user, senha = os.environ.get('BERNHOEFT_USER'), os.environ.get('BERNHOEFT_PASSWORD')
    if not user or not senha:
        log('BERNHOEFT_USER/BERNHOEFT_PASSWORD não definidos.')
        return 3
    global AUDIO, recaptchav2
    if AUDIO:
        try:
            import static_ffmpeg
            static_ffmpeg.add_paths()  # FFmpeg embutido (o solver de áudio precisa dele para converter o áudio)
            from playwright_recaptcha import recaptchav2
        except ImportError as e:
            log(f'Áudio desligado: biblioteca ausente ({e.name}). Instale requirements-captcha.txt para usá-lo.')
            AUDIO = False
    reserva = servicos_disponiveis()
    log('Captcha: ' + ('áudio, depois ' if AUDIO else '')
        + ('serviços pagos: ' + ', '.join(reserva) if reserva else 'nenhum serviço pago (sem chave configurada)'))
    if not reserva and not AUDIO:
        log('Sem chave de serviço de captcha e com o áudio desligado. Configure TWOCAPTCHA_API_KEY (ou outra) '
            'ou use o login manual: node login.js')
        return 3
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            PROFILE,
            executable_path=CHROME,
            headless=HEADLESS,
            locale='en-US',  # para o áudio: sem isso o solver de áudio não acha o link do MP3
            args=['--no-sandbox'] if sys.platform.startswith('linux') else [],
            viewport={'width': 1280, 'height': 800},
        )
        try:
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            for n in range(1, TENTATIVAS + 1):
                page.goto(BASE + '/Home', wait_until='domcontentloaded')
                page.wait_for_load_state('networkidle')
                if page.query_selector('#password') is None:
                    log('Sessão já ativa.')
                    return 0
                # 1) primeiro o áudio grátis (CAPTCHA_AUDIO=0 desliga)
                if AUDIO:
                    t = time.time()
                    try:
                        preencher(page, user, senha)
                        with recaptchav2.SyncSolver(page) as solver:
                            token = solver.solve_recaptcha(wait=True, image_challenge=False)
                        log(f'Tentativa {n}: captcha resolvido por áudio em {time.time() - t:.1f}s.')
                        page.click('#BotaoLogin')
                        if entrou(page):
                            finalizar(page)
                            return 0
                        log(f'Tentativa {n}: o portal não aceitou o login (senha errada?).')
                    except Exception as e:  # timeout, áudio recusado pelo Google, etc.
                        log(f'Tentativa {n}: áudio falhou ({type(e).__name__}: {str(e).splitlines()[0][:100]}).')

                # 2) se o áudio falhar, serviços pagos na ordem de CAPTCHA_FALLBACK, só os que têm chave
                for nome in list(reserva):
                    try:
                        page.goto(BASE + '/Home', wait_until='domcontentloaded')
                        page.wait_for_load_state('networkidle')
                        preencher(page, user, senha)
                        sitekey = achar_sitekey(page)
                        if not sitekey:
                            raise RuntimeError('sitekey do reCAPTCHA não encontrada na página')
                        t = time.time()
                        token = resolver_com_servico(nome, sitekey, page.url)
                        log(f'Tentativa {n}: captcha resolvido por {nome} em {time.time() - t:.1f}s.')
                        injetar_token(page, token)
                        page.click('#BotaoLogin')
                        if entrou(page):
                            finalizar(page)
                            return 0
                        log(f'Tentativa {n}: o portal não aceitou o token de {nome}.')
                    except Exception as e:
                        log(f'Tentativa {n}: {nome} falhou ({type(e).__name__}: {str(e)[:120]}).')
                        if any(c in str(e) for c in ERROS_DEFINITIVOS):
                            reserva.remove(nome)
                            log(f'{nome} retirado das próximas tentativas (chave inválida ou sem saldo).')

                if n < TENTATIVAS:
                    time.sleep(15 * n if AUDIO else 5)  # o Google limita desafios de áudio seguidos: espera antes de tentar de novo
            log('Não foi possível logar automaticamente. Use: node login.js')
            return 3
        finally:
            ctx.close()


if __name__ == '__main__':
    sys.exit(main())
