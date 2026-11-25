# Veyronix — publicação online e APK Android

Este pacote prepara a Etapa 12.4 para funcionar com um único servidor HTTPS remoto e um aplicativo Android Capacitor. O APK carrega a mesma interface hospedada no servidor; contas, mensagens, comunidades e sinalização WebRTC continuam no backend.

## 1. Publicar o servidor (Render)

1. Envie a pasta `Veyronix-Web-Etapa2` para um repositório GitHub.
2. No Render, crie um Blueprint usando o arquivo `render.yaml` desse repositório.
3. O Blueprint configura um serviço Node, uma unidade persistente montada em `/var/data` e o banco em `/var/data/veyronix.sqlite`.
4. O disco persistente é necessário para não perder o SQLite em reinicializações/deploys. O plano configurado é pago; não use serviço gratuito com filesystem efêmero para guardar o banco.
5. Preencha no painel do serviço as variáveis SMTP para confirmação/recuperação por e-mail. Sem SMTP válido, esses e-mails não serão enviados.
6. Para chamadas entre redes diferentes, configure credenciais TURN reais nas variáveis `TURN_SERVER_URL`, `TURN_USERNAME` e `TURN_CREDENTIAL`. O STUN público sozinho não garante conexão em todas as redes.
7. Depois do deploy, abra `https://SEU-SERVICO.onrender.com/health`. A resposta esperada contém `ok: true`.

### Variáveis principais

- `NODE_ENV=production`
- `DATABASE_PATH=/var/data/veyronix.sqlite`
- `SESSION_SECRET`: gerada pelo Render; não compartilhe.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`
- `TURN_SERVER_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` (recomendado para WebRTC)

O servidor ativa `trust proxy` em produção para que os cookies Secure funcionem atrás do proxy HTTPS. O endpoint `/health` é usado pela plataforma para verificar a aplicação.

## 2. Configurar o APK pelo GitHub Actions

O projeto usa Capacitor 8. O APK é compilado na nuvem; não é necessário instalar Android Studio no celular.

1. Envie todos os arquivos deste projeto ao seu repositório GitHub, mantendo `.github/workflows/build-android-apk.yml`, `capacitor.config.json` e `scripts/`.
2. No GitHub, abra **Settings → Secrets and variables → Actions → Variables → New repository variable**.
3. Nome: `VEYRONIX_SERVER_URL`. Valor: URL HTTPS do serviço publicado, por exemplo `https://veyronix-seuapp.onrender.com` (use a URL real criada no Render).
4. Abra a aba **Actions**, selecione **Build Veyronix Android APK** e toque em **Run workflow**.
5. Quando terminar, abra a execução e baixe o artefato `Veyronix-Android-debug`. Dentro dele estará `app-debug.apk`.

O workflow usa Node 22, Java 21 e Android SDK para gerar um APK de depuração. Para distribuição pública, será necessário configurar assinatura Android (keystore) e gerar uma versão release; não coloque keystore ou senhas no código.

## 3. Importante sobre chamadas e compartilhamento

- A sala WebRTC atual é peer-to-peer em malha. Para chamadas entre redes móveis/Wi-Fi, configure TURN e teste com duas contas em redes diferentes. Salas grandes precisam de um SFU.
- O APK inicial é um contêiner Capacitor que abre o site HTTPS. As permissões Android básicas são declaradas, mas isso não equivale a uma implementação nativa completa de chamadas em segundo plano.
- Manter áudio ativo com o app minimizado exige serviço Android em primeiro plano, notificação persistente e tratamento nativo do ciclo de vida.
- Captura de tela do Android exige `MediaProjection` e consentimento do sistema; a API web `getDisplayMedia` não é suportada em todos os navegadores/WebViews móveis. A etapa atual não implementa esse módulo nativo.
- Portanto, não considere chamadas em segundo plano nem compartilhamento de tela móvel garantidos neste primeiro APK. Teste primeiro em primeiro plano.

## 4. Testes obrigatórios antes de convidar outras pessoas

- Criar conta e confirmar e-mail.
- Entrar e sair, fechar e reabrir o app.
- Criar servidor, categoria e canais; enviar mensagens e anexos.
- Testar duas contas em aparelhos diferentes.
- Testar áudio com microfone permitido e TURN configurado.
- Confirmar que dados continuam após reiniciar/redeployar o servidor.

## 5. Desenvolvimento local

O servidor continua sendo executado com `npm start`. Não execute o servidor Node dentro do APK de produção. O app Android deve conectar ao servidor HTTPS hospedado.
