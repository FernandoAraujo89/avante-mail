import { getBaseUrl } from "@/lib/email";
import type { BaseLegal } from "@/lib/track/base-legal";

/**
 * O script que o site avantejuntos.com.br carrega (fase E).
 *
 * Servido por rota, e não de `public/`: o matcher do middleware pega tudo que
 * não é `_next`, então um arquivo em `public/` seria REDIRECIONADO PARA O LOGIN
 * e o site receberia HTML no lugar de JavaScript. (Foi por isso que `/fonts/` e
 * `/icon.svg` precisaram entrar à mão em PUBLIC_PREFIXES.) Aqui o caminho
 * `/api/track/site.js` cai sob o prefixo público `/api/track/` que já existe.
 *
 * Princípios que valem para cada linha abaixo, porque isto roda no site
 * institucional de outra equipe:
 *  - não quebrar a página, nunca. Tudo em try/catch, nada síncrono, nada que
 *    dependa de biblioteca;
 *  - não coletar nada sem consentimento explícito;
 *  - não atrapalhar o Voltar do navegador nem o bfcache.
 */
export function corpoDoScript(baseLegal: BaseLegal = "consentimento"): string {
  const base = getBaseUrl();
  // A base legal entra no script como constante, e não como consulta em tempo
  // de execução: o script não pode depender de uma chamada extra para saber se
  // pode funcionar. Trocar o modo muda o corpo, logo muda o ETag, então os
  // navegadores pegam a versão nova na próxima revalidação (até 1h).
  const coletaPorPadrao = baseLegal === "legitimo_interesse";
  return `/* Avante — rastreio de leads. Gerado por /api/track/site.js */
(function () {
  "use strict";

  var VERSAO = "1";
  // Carga dupla é o cenário MAIS provável (tag no cabeçalho e no rodapé), e o
  // pior: duas cópias disputando o patch de history quebrariam a navegação do
  // site. A guarda vem antes de qualquer efeito colateral.
  if (window.__avRastreio) return;
  window.__avRastreio = VERSAO;

  var ENDPOINT = ${JSON.stringify(`${base}/api/track/site`)};
  // Base legal declarada no sistema. Com legítimo interesse a coleta começa no
  // carregamento; com consentimento, só depois de o site autorizar. O que NÃO
  // muda: GPC/DNT bloqueiam nos dois casos, e um "não" explícito vale nos dois.
  var COLETA_POR_PADRAO = ${coletaPorPadrao};
  var CHAVE_TOKEN = "av_token";
  var CHAVE_SESSAO = "av_sessao";
  // A RECUSA é persistida; o consentimento não. A assimetria é deliberada:
  // quem manda no "sim" é o banner do site, que o reafirma a cada página; mas
  // um "não" que sumisse ao recarregar não seria um "não". Sem isto, bastava
  // um F5 — ou um clique num e-mail futuro — para o rastreio voltar sozinho.
  var CHAVE_RECUSA = "av_recusado";

  var token = null;          // só em memória até haver consentimento
  var sessao = null;
  var consentido = false;
  var recusado = false;      // "não" explícito: para de coletar, não só de enviar
  var fila = [];
  var ultimoPath = null;
  var depurar = false;

  function log() {
    if (!depurar) return;
    try { console.log.apply(console, ["[av]"].concat([].slice.call(arguments))); } catch (e) {}
  }

  // ── Sinais de privacidade do navegador ────────────────────────────────
  // Bloqueio duro: se a pessoa pediu para não ser rastreada, nem o
  // consentimento do banner faz o script enviar.
  function recusaDoNavegador() {
    try {
      if (navigator.globalPrivacyControl === true) return "GPC";
      var dnt = navigator.doNotTrack || window.doNotTrack;
      if (dnt === "1" || dnt === 1 || dnt === true) return "DNT";
    } catch (e) {}
    return null;
  }

  // ── Armazenamento tolerante (aba anônima bloqueia) ────────────────────
  function ler(chave, sessaoOnly) {
    try {
      var loja = sessaoOnly ? window.sessionStorage : window.localStorage;
      return loja.getItem(chave);
    } catch (e) { return null; }
  }
  function gravar(chave, valor, sessaoOnly) {
    try {
      var loja = sessaoOnly ? window.sessionStorage : window.localStorage;
      loja.setItem(chave, valor);
    } catch (e) {}
  }
  function apagar(chave, sessaoOnly) {
    try {
      var loja = sessaoOnly ? window.sessionStorage : window.localStorage;
      loja.removeItem(chave);
    } catch (e) {}
  }

  function novaSessao() {
    var s = "s";
    try {
      var buf = new Uint8Array(12);
      (window.crypto || window.msCrypto).getRandomValues(buf);
      for (var i = 0; i < buf.length; i++) s += ("0" + buf[i].toString(16)).slice(-2);
    } catch (e) {
      s += String(Date.now()) + Math.random().toString(36).slice(2, 10);
    }
    return s.slice(0, 40);
  }

  // ── Captura do token vindo do e-mail ──────────────────────────────────
  // Lê o ?av= para a MEMÓRIA e limpa a URL na mesma volta. Limpar não é
  // detalhe: sem isso o visitante copia a barra de endereço e manda no grupo
  // do WhatsApp, e todo mundo que abrir passa a ser rastreado COMO ELE — a
  // ficha e a pontuação de outra pessoa entrando na dele, em silêncio.
  function capturarToken() {
    try {
      var url = new URL(window.location.href);
      var vindo = url.searchParams.get("av");
      if (!vindo) return;
      // Quem recusou não é identificado — mas a URL é limpa do mesmo jeito.
      // Deixar o token na barra de endereço de quem disse "não" seria o pior
      // dos dois mundos: não rastreamos, e ainda assim o identificador fica
      // exposto para ser copiado, compartilhado e registrado em log de acesso.
      if (!recusado) token = vindo;
      url.searchParams.delete("av");
      // replaceState, não pushState: o botão Voltar não pode devolver a URL
      // com o token. Só o "av" sai — as UTMs ficam, senão quebramos a
      // analítica do próprio site.
      window.history.replaceState(window.history.state, "", url.toString());
      log("token capturado da URL");
    } catch (e) {}
  }

  // ── Envio ─────────────────────────────────────────────────────────────
  function enviar(usarBeacon) {
    if (!consentido || !token || fila.length === 0) return;
    // GPC/DNT conferidos NO ENVIO, e não só na hora do aceite: o sinal pode
    // aparecer depois (extensão que liga, aba nova), e o que importa é o
    // instante em que o dado sairia daqui.
    if (recusaDoNavegador()) { fila = []; return; }
    var lote = fila.splice(0, 20);
    var corpo = JSON.stringify({ t: token, s: sessao, e: lote });

    // text/plain evita o preflight (requisição simples), e o servidor lê o
    // corpo cru de qualquer jeito.
    var tipo = "text/plain;charset=UTF-8";

    if (usarBeacon && navigator.sendBeacon) {
      try {
        var ok = navigator.sendBeacon(ENDPOINT, new Blob([corpo], { type: tipo }));
        log("beacon", ok, lote.length);
        if (!ok) fila = lote.concat(fila);
        return;
      } catch (e) { fila = lote.concat(fila); }
      return;
    }

    try {
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": tipo },
        body: corpo,
        keepalive: true,
        credentials: "omit",
        mode: "cors",
      })
        .then(function (r) {
          if (!r.ok) return null;
          return r.json().catch(function () { return null; });
        })
        .then(function (dados) {
          if (!dados) return;
          if (dados.esquecer) {
            // O servidor diz que este token não vale mais (expirou, ou a
            // pessoa pediu para sair). Some com ele em vez de tentar para
            // sempre.
            token = null;
            apagar(CHAVE_TOKEN);
            fila = [];
            log("token descartado a pedido do servidor");
          } else if (dados.t) {
            token = dados.t;
            gravar(CHAVE_TOKEN, dados.t);
            log("token renovado");
          }
        })
        .catch(function () {
          // Endpoint fora do ar: devolve o lote para a próxima tentativa, mas
          // sem laço — a próxima navegação tenta de novo.
          fila = lote.concat(fila);
        });
    } catch (e) {
      fila = lote.concat(fila);
    }
  }

  function enfileirar(item) {
    // Depois de um "não" explícito não se coleta nem para a memória. Enquanto
    // a pessoa ainda não respondeu o banner, a fila segura (nada sai daqui) —
    // é o que evita perder a página de entrada, que costuma ser a mais
    // reveladora da visita.
    if (recusado) return;
    if (fila.length > 40) return; // teto de memória; site não é fila de log
    fila.push(item);
    if (consentido && token) enviar(false);
  }

  // ── O que é observado ─────────────────────────────────────────────────
  function caminhoAtual() {
    try { return window.location.pathname || "/"; } catch (e) { return "/"; }
  }

  function pagina() {
    var path = caminhoAtual();
    // Numa SPA o mesmo caminho pode ser "navegado" várias vezes; contar duas
    // vezes a mesma página não acrescenta informação.
    if (path === ultimoPath) return;
    ultimoPath = path;
    enfileirar({
      tipo: "visita",
      path: path,
      titulo: (document.title || "").slice(0, 200),
      ref: document.referrer || "",
    });
    log("pagina", path);
  }

  function evento(nome) {
    if (!nome) return;
    enfileirar({ tipo: "evento", nome: String(nome), path: caminhoAtual() });
    log("evento", nome);
  }

  // ── Consentimento ─────────────────────────────────────────────────────
  function consentimento(valor) {
    var recusa = recusaDoNavegador();
    if (valor && recusa) {
      log("consentimento ignorado:", recusa);
      return;
    }
    if (valor) {
      consentido = true;
      recusado = false;
      apagar(CHAVE_RECUSA);
      // Só agora o token e a sessão saem da memória para o armazenamento.
      if (token) gravar(CHAVE_TOKEN, token);
      if (sessao) gravar(CHAVE_SESSAO, sessao, true);
      log("consentimento concedido");
      enviar(false);
    } else {
      consentido = false;
      recusado = true;
      gravar(CHAVE_RECUSA, "1");
      fila = [];
      // Some com a identificação inclusive da MEMÓRIA: manter o token depois
      // de um "não" seria guardar um identificador de pessoa sem base para
      // isso, mesmo sem transmitir.
      token = null;
      // Revogar apaga o que está NESTE navegador. O histórico já coletado é
      // pedido de titular, atendido por um operador na ficha do lead — um
      // endpoint público que apaga evento por token seria convite a estrago.
      apagar(CHAVE_TOKEN);
      apagar(CHAVE_SESSAO, true);
      log("consentimento revogado");
    }
  }

  // ── API pública ───────────────────────────────────────────────────────
  function comando(acao) {
    try {
      var args = [].slice.call(arguments, 1);
      // === true ESTRITO. Com "!== false", av('consentimento') sem argumento
      // consentiria — e o caso real é pior: o banner do site chama
      // av('consentimento', prefs.analytics), e uma preferência ainda não
      // carregada chega como undefined. O portão precisa falhar FECHADO.
      if (acao === "consentimento") return consentimento(args[0] === true);
      if (acao === "evento") return evento(args[0]);
      if (acao === "pagina") return pagina();
      if (acao === "debug") { depurar = args[0] !== false; return log("debug ligado"); }
      if (acao === "estado") {
        return { versao: VERSAO, identificado: !!token, consentido: consentido, fila: fila.length };
      }
    } catch (e) {}
  }

  // ── Ligação com a página ──────────────────────────────────────────────
  function ligar() {
    if (!token) token = ler(CHAVE_TOKEN);
    sessao = ler(CHAVE_SESSAO, true) || novaSessao();

    // Legítimo interesse: já nasce coletando — MENOS para quem recusou antes
    // (o "não" é persistido e vale para sempre neste navegador) e menos sob
    // GPC/DNT, que o envio confere a cada lote. A recusa vence o modo, nunca o
    // contrário.
    if (COLETA_POR_PADRAO && !recusado && !recusaDoNavegador()) {
      consentido = true;
      // Sem uma chamada de consentimento para fazer isso, é aqui que o token e
      // a sessão passam a sobreviver à navegação entre páginas.
      if (token) gravar(CHAVE_TOKEN, token);
      gravar(CHAVE_SESSAO, sessao, true);
    }

    // Cliques em elementos marcados: data-av-evento="demo". Delegado no
    // documento, então funciona para conteúdo que aparece depois.
    document.addEventListener("click", function (ev) {
      try {
        var alvo = ev.target;
        while (alvo && alvo !== document.body) {
          if (alvo.getAttribute && alvo.getAttribute("data-av-evento")) {
            evento(alvo.getAttribute("data-av-evento"));
            return;
          }
          alvo = alvo.parentNode;
        }
      } catch (e) {}
    }, true);

    // Navegação sem recarga (SPA). Guardar a original e DEVOLVER o retorno
    // dela: se este patch engolir o retorno ou lançar, o roteador do site
    // quebra — é a linha mais perigosa do arquivo.
    function patch(nome) {
      var original = window.history[nome];
      if (typeof original !== "function") return;
      window.history[nome] = function () {
        var r = original.apply(this, arguments);
        try { setTimeout(pagina, 0); } catch (e) {}
        return r;
      };
    }
    patch("pushState");
    patch("replaceState");
    window.addEventListener("popstate", function () { pagina(); });

    // Descarga ao sair. NUNCA em unload/beforeunload: desabilitam o bfcache no
    // Chrome e no Safari, o que seria uma regressão de desempenho no site
    // causada por nós.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") enviar(true);
    });
    window.addEventListener("pagehide", function () { enviar(true); });

    // Comandos chamados antes de o script carregar (a tag é async).
    var pendentes = (window.av && window.av.q) || [];
    window.av = comando;
    window.av.q = [];
    for (var i = 0; i < pendentes.length; i++) {
      try { comando.apply(null, pendentes[i]); } catch (e) {}
    }

    pagina();
  }

  try {
    // A RECUSA vem antes de tudo: se a pessoa já disse não neste navegador, o
    // script não captura token, não limpa URL e não observa nada.
    recusado = ler(CHAVE_RECUSA) === "1";

    // A captura acontece AGORA, na execução do script — não no
    // DOMContentLoaded. A tag é async, então esperar significaria deixar
    // "?av=<token que identifica a pessoa>" na barra de endereço durante todo
    // o carregamento, à vista de qualquer script de terceiro da página (e do
    // GA4, que manda a URL inteira). Quanto menor essa janela, melhor. Roda
    // mesmo com recusa: ali dentro ela decide não guardar o token, mas a
    // limpeza da URL vale para os dois casos.
    capturarToken();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", ligar);
    } else {
      ligar();
    }
  } catch (e) {}
})();
`;
}
