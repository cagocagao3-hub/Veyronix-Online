# Veyronix Web — Etapa 5

Atualização incremental da Etapa 4. Mantém o backend Node.js + Express e SQLite integrado, compatível com Node.js 24 no Termux usando `node:sqlite`.

## Novidades da Etapa 5

- Substituição dos `prompt()` nativos do navegador por diálogos próprios em HTML/CSS para criar servidor, entrar por convite e criar canal.
- Correção do avatar: quando existe foto, a inicial não é mais escrita por cima da imagem (o antigo “S”/letra solta).
- Upload de avatar e banner em PNG, JPG, WEBP ou GIF, com limite de 10 MB por arquivo.
- Banner GIF mantido como GIF animado na prévia e no perfil.
- Perfis públicos: tocar no avatar ou nome de quem enviou uma mensagem abre um cartão com foto, banner, nome, @usuário, bio, selo Beta Veyronix e data de entrada.
- Endpoint público autenticado `/api/users/:username`, que expõe apenas dados de perfil e nunca e-mail ou informações privadas.
- Aumentado o limite do JSON para receber imagens de até 10 MB (uma imagem por envio de formulário).

## Instalação no Termux

1. Pare o servidor com `CTRL + C`.
2. Faça backup de `data/` e do `.env`.
3. Extraia o ZIP mantendo a pasta `Veyronix-Web-Etapa2`.
4. Execute:

```bash
cd ~/Veyronix-Web-Etapa2
npm install
npm start
```

**Não apague `data/` nem substitua seu `.env`.** A atualização preserva o banco SQLite existente. Node.js 24 é necessário por causa do módulo integrado `node:sqlite`.

## Observações honestas

- O limite de 10 MB é aplicado no navegador e validado novamente no servidor. O banco guarda as imagens como Data URL; para uma instalação com muitos usuários, o próximo passo recomendado é migrar os arquivos para armazenamento de objetos.
- GIF é aceito e exibido como mídia animada pelo navegador.
- O perfil público só pode ser aberto por usuários autenticados.
- Chamadas de voz/vídeo, compartilhamento de tela, mensagens diretas e permissões avançadas ainda não fazem parte desta etapa.


## Etapa 6 — Social e mensagens privadas

Inclui pesquisa exata de usuário, solicitações de amizade, lista de amigos, conversas privadas persistidas em SQLite, anexos de imagem/PDF/TXT e gravação de áudio pelo navegador. Arquivos privados são enviados como dados da mensagem e limitados a 8 MB. A gravação de áudio exige navegador compatível e permissão do microfone; em produção, use HTTPS.


## Etapa 7 — conta, privacidade e segurança

- Minha conta: exibição do e-mail e usuário, edição do perfil e saída da conta.
- Dados e privacidade: perfil público/privado, controle de solicitações, exportação JSON e lista de bloqueados.
- Senha e segurança: troca de senha com validação da senha atual; outros dispositivos são desconectados após a troca.
- Dispositivos: registro de sessões após login, encerramento individual e encerramento de outros dispositivos.
- Perfil: ações para remover avatar e banner sem precisar enviar uma imagem substituta.
- Social: layout reorganizado, busca exata, bloqueio de usuários e feedback visual.
- Servidores: endpoints de consulta de membros e alteração de cargos com validação de permissões no servidor.
- Interface: remoção do destaque azul de toque padrão em botões e controles, mantendo foco visível por teclado.

A migração das tabelas de preferências, bloqueios e dispositivos é executada automaticamente na inicialização. Preserve a pasta `data` e o arquivo `.env`.

Limitações desta etapa: não inclui chamadas de voz/vídeo nem compartilhamento de tela; esses recursos exigem sinalização WebRTC e infraestrutura de mídia/HTTPS. A alteração de e-mail também não está habilitada, pois requer fluxo de confirmação por e-mail.


## Etapa 8 — Navegação social
- Barra lateral com alternância entre servidores e amigos.
- Servidores e amigos aparecem como ícones/avatares na coluna principal, em padrão inspirado no Discord.
- O botão de mensagens abre a lista de amigos; tocar em um amigo abre sua conversa privada.
- Removida a aba duplicada “Meus amigos” da janela Encontrar amigos; a lista de amigos fica na navegação lateral.
- O ícone de servidor usa imagem quando o backend fornece um ícone em data URI; caso contrário, mostra a inicial.
- Ajustes de foco e destaque de toque para evitar o flash azul padrão do navegador.


## Etapa 9 — experiência de servidor

- Navegação por servidores e canais com categorias recolhíveis.
- Painel de membros do servidor com busca por nome visível ou usuário.
- Agrupamento de membros por cargos, com destaque de Owner e Membro.
- Perfil público acessível ao tocar em um membro, com banner, avatar, bio e cargos daquele servidor.
- Criação de categorias e cargos por proprietários/administradores; atribuição de cargos pelo perfil do membro.
- Migração automática do banco existente para criar categorias e cargos padrão sem apagar contas, amizades ou mensagens.

A experiência é inspirada na organização de comunidades do Discord, mantendo a identidade visual própria do Veyronix.


## Etapa 10 — gerenciamento e navegação

- A barra lateral mostra os ícones de todos os servidores, mas o painel de canais exibe somente o servidor selecionado.
- A criação de servidor aceita ícone quadrado (PNG, JPG, WEBP ou GIF), com prévia e remoção nas configurações.
- Configurações do servidor permitem editar nome/descrição/ícone, excluir o servidor, criar e excluir categorias/canais/cargos e configurar quais cargos podem visualizar ou enviar mensagens em cada canal.
- As permissões de canal são verificadas também no backend; proprietário e administradores mantêm acesso administrativo. Quando nenhum cargo é selecionado, o acesso é aberto a todos os membros.
- Amigos abre a lista de amizades; Caixa de entrada abre solicitações recebidas; Mensagens mantém o acesso às conversas.
- Cargos padrão artificiais “Membro” e “Owner” foram removidos da lista de cargos personalizados. O proprietário continua identificado como proprietário, sem criar um cargo fictício.

A migração é automática ao iniciar o servidor e preserva as contas, mensagens e relações existentes. Faça uma cópia da pasta `data` antes de atualizar, como em qualquer mudança de banco de dados.

## Atualização 0.8.0 — Servidores e mensagens

- Organização dos membros por cargo de maior prioridade, sem repetir a mesma pessoa em vários grupos.
- Atribuição e remoção de cargos no perfil de membro (para quem tem permissão).
- Seleção da categoria de cada canal nas configurações do servidor.
- Mensagem de início mais clara em canais sem conversas; ela some automaticamente quando chega a primeira mensagem.
- Mantida a estrutura de categorias, canais, permissões, convites e mensagens da versão anterior.


## Atualização 0.8.1 — servidores e canais

- Ícones de servidor agora são normalizados em um quadro quadrado sem cortar ou esticar a arte.
- Fechamento das configurações com botão X fixo e acessível em telas pequenas.
- Permissões de leitura e envio organizadas em seletores compactos por cargo.
- Criação de cargos com nome e cor, além de edição de nome/cor.
- Botão de exclusão do servidor aparece somente para o proprietário; a API também valida a propriedade.
- Convites tentam a API moderna de clipboard e usam alternativa compatível quando o navegador bloqueia a cópia.
- Removida a etiqueta visual “Beta Veyronix” do perfil e das mensagens.

Observação: chamadas de voz/vídeo reais ainda não estão incluídas nesta versão. Elas exigem sinalização WebRTC, conexão segura HTTPS e testes com dois dispositivos; não foi adicionado um botão de chamada fictício.


## Etapa 11.3 — imagens e validações de convite
- Ícones aceitam arquivos PNG/JPG/WEBP entre 200×200 e 2500×2500 pixels (até 8 MB), processados em imagem quadrada de alta qualidade para exibição circular.
- A imagem do servidor também é aplicada como fundo visual escurecido da área de conversas.
- Convites agora recusam códigos inválidos, tentativas do proprietário de entrar no próprio servidor e entradas repetidas de quem já é membro.
- Se a cópia automática do convite não funcionar em um navegador sem HTTPS, o código abre em uma janela selecionável para cópia manual.


## Etapa 11.5 e 11.6 — cargos, categorias privadas e acabamento

- A imagem do servidor pode ser selecionada tocando diretamente na prévia circular; o seletor de arquivo nativo fica oculto.
- A imagem do servidor é exibida no ícone circular e como fundo visual escurecido da área de conversas. A casinha remove o fundo do servidor e retorna à página inicial.
- O painel de categorias permite alternar entre pública e privada e escolher visualmente quais cargos podem visualizar a categoria.
- A API filtra categorias/canais privados e valida o acesso no servidor ao abrir e enviar mensagens.
- O proprietário pode adicionar/remover cargos no próprio perfil; administradores não podem alterar o proprietário. O gerenciamento continua disponível no perfil dos demais membros para a equipe autorizada.
- Os cargos continuam editáveis por nome e cor nas configurações do servidor.
- Mensagens próprias têm um menu compacto de três pontos com opção de exclusão; o servidor valida que a mensagem pertence à conta que pediu a exclusão.
- A identificação BETA é exibida somente como texto verde, sem ícone.
- Ao voltar pela casinha, a tela inicial não herda o papel de parede do servidor.

As mensagens de canais e as mensagens privadas continuam armazenadas no banco SQLite existente. Não apague `data/` ao atualizar. Chamadas de voz/vídeo reais continuam fora desta etapa; não há botão de chamada fictício.


## Etapa 11.7 — perfil, navegação e persistência

- Estado vazio de amigos ajustado para exibir “Sem amigos” por inteiro na barra lateral móvel.
- Botão de gerenciamento de cargos no perfil reduzido para o ícone `+`.
- Selo `BETA` verde exibido ao lado do nome no perfil público e na prévia do próprio perfil.
- Nome principal limitado a 20 caracteres também no servidor (validação de API).
- SQLite com `synchronous=FULL`, `busy_timeout` e checkpoint WAL ao encerrar o servidor pelo Termux.
- Mensagens de canais e conversas privadas continuam gravadas no banco SQLite; não remova a pasta `data` ao atualizar.

## Atualização 11.8 — mensagens e menu de ações
- O menu de ações das mensagens agora é renderizado fora da área rolável para não ser cortado pelo chat.
- Abertura/fechamento consistente por toque ou clique, fechamento ao tocar fora, pressionar Escape, rolar o chat ou redimensionar a tela.
- Ações disponíveis: copiar o texto da mensagem e excluir a própria mensagem.
- Exclusão mantém a validação no servidor: cada usuário só pode apagar mensagens que pertencem à própria conta.
- Ajustes de foco por teclado, áreas de toque e aparência em telas pequenas.


## Etapa 11.9 — navegação lateral e interface compacta
- Rolagem vertical independente para servidores e amigos no trilho esquerdo, em telas pequenas e grandes.
- Ícones fixos de início, mensagens, adicionar servidor e configurações permanecem no lugar enquanto a lista rola.
- Posição de rolagem preservada durante atualizações da lista.
- Botões mantidos compactos; o botão de opções da mensagem voltou ao tamanho compacto e os itens do menu foram reduzidos.
- Abertura do menu de mensagem tratada em fase de captura para evitar que outros handlers da página impeçam o toque.
- Fechamento do menu ao trocar de aba, ocultar a página, redimensionar ou pressionar Escape.


## Atualização 11.10
- Corrigido o fluxo de exclusão de servidor: o painel de configurações fecha antes da confirmação por nome.
- A confirmação valida o proprietário, permite cancelar sem excluir e só remove o servidor após o nome exato.
- O botão de ajuda do cabeçalho agora explica as ações principais; o sino continua abrindo as solicitações recebidas.


## Etapa 11.12 — cargos e hierarquia

- Editor de cargos recolhido por padrão, com edição sob demanda e controles compactos.
- Alteração da ordem dos cargos com setas discretas; a ordem é persistida no servidor.
- O primeiro cargo atribuído ao membro define a cor do nome nas mensagens e na lista de membros.
- A lista de membros agrupa cada pessoa pelo primeiro cargo atribuído; grupos seguem a prioridade configurada dos cargos.
- Os botões Adicionar/Remover no seletor de cargos usam dimensões equivalentes.

## Etapa 11.13 — avatares e troca de conta
- A seleção do servidor ativo agora usa um contorno roxo fino e discreto.
- Avatares de mensagens, amigos e conta usam preenchimento consistente; fotos ocupam o espaço inteiro e contas sem foto mostram a inicial em fundo roxo.
- Login, confirmação e saída recarregam a aplicação para limpar estados visuais antigos. As consultas de sessão e API usam `cache: no-store` para evitar dados antigos após trocar de conta.
- Ao detectar uma troca de usuário na mesma página, os temporizadores e estados de servidor, canal, amigos e conversas são limpos.


## Etapa 11.15 — mensagens privadas aprimoradas

- Menu compacto de três pontos apenas nas mensagens enviadas pela própria conta.
- Copiar texto da mensagem e excluir a própria mensagem, com validação também no servidor.
- Imagens abrem em visualizador de tela cheia e podem ser baixadas.
- Anexos de áudio, vídeo, PDF, texto, CSV, ZIP e documentos comuns com link de download; áudio e vídeo compatíveis podem ser reproduzidos no chat.
- Gravação de áudio usa MediaRecorder e envia o arquivo como mensagem de voz.
- Janela de conversa sem borda roxa forte, com ações discretas e botões compactos.

**Requisito do microfone:** o navegador precisa de contexto seguro (HTTPS ou localhost/127.0.0.1) e permissão de microfone. Abrir por um IP local em HTTP pode bloquear a gravação.

**Ainda não incluído nesta etapa:** canais de voz multiusuário e compartilhamento de tela. Esses recursos precisam de sinalização WebRTC, presença de participantes, renegociação de mídia e HTTPS em produção. Não foram simulados com botões falsos.


## Etapa 11.17 — correção definitiva dos avatares nas mensagens
- Corrigida a regra CSS que aplicava o fundo roxo com `!important` por cima da foto enviada pelo perfil.
- Mensagens em canais de texto agora exibem a foto de perfil quando cadastrada.
- Quando a conta não possui foto, aparece a primeira letra do nome centralizada em um avatar roxo preenchido.
- Corrigidas também as regras de fundo dos avatares de amigos para não encobrir imagens.
- Mantidos tamanhos e dimensões atuais dos botões e avatares.


## Etapa 12 — canais de voz WebRTC

Esta atualização adiciona conexão real de áudio entre participantes usando WebRTC e sinalização autenticada pelo backend SQLite:

- Ao tocar em um canal de voz, aparece a confirmação **Conectar**.
- Ao conectar, o participante aparece com foto de perfil ou inicial, nome e estado do microfone.
- Controles para ativar/desativar microfone, silenciar o áudio recebido, escolher microfone/saída quando o navegador oferece suporte e sair do canal.
- Compartilhamento de tela via `getDisplayMedia`, com vídeo remoto dentro da sala quando o navegador disponibiliza a API.
- Mensagens de voz privadas continuam usando `MediaRecorder` e envio de arquivo de áudio.
- Presença temporária e troca de ofertas/ICE são armazenadas no SQLite; participantes inativos expiram automaticamente.

### Requisitos e limites importantes

1. **HTTPS é necessário** para microfone e compartilhamento de tela, exceto em `localhost`/`127.0.0.1`. No próprio celular, teste abrindo `http://127.0.0.1:3000`; `http://0.0.0.0:3000` não é o endereço recomendado para acessar pelo navegador. Para outras pessoas acessarem, publique atrás de HTTPS.
2. O navegador precisa permitir microfone e, para compartilhar tela, oferecer `navigator.mediaDevices.getDisplayMedia`. O suporte de captura de tela em celulares varia por navegador e versão; não é possível forçar a API em aparelhos que não a oferecem.
3. O projeto inclui STUN público como configuração inicial. Para chamadas confiáveis entre redes móveis/Wi-Fi diferentes, configure um serviço **TURN** próprio no `.env` (`TURN_SERVER_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`). Sem TURN, algumas redes podem impedir a conexão direta.
4. A seleção de saída de áudio depende de `HTMLMediaElement.setSinkId`, que não existe em todos os navegadores móveis. Quando não houver suporte, o áudio usa a saída padrão do sistema.
5. Esta é uma implementação inicial de sala WebRTC em malha (peer-to-peer). Salas grandes precisam de um servidor de mídia SFU para escalar melhor; a qualidade também depende da rede e do navegador.

Não é correto prometer funcionamento perfeito em qualquer aparelho/rede: valide com duas contas e dois dispositivos, usando HTTPS e TURN para um teste real entre redes.


## Correção — acesso local e modal de conexão de voz

- Ao abrir `http://0.0.0.0:3000` no mesmo aparelho, o navegador é redirecionado para `http://127.0.0.1:3000`, endereço de loopback reconhecido como contexto seguro para permissões de microfone.
- Os botões **Cancelar** e **Conectar** do diálogo de voz usam duas colunas iguais e a mesma altura, inclusive em telas pequenas.
- Para abrir o Veyronix em outro aparelho pela rede ou pela internet, use um domínio/host publicado com HTTPS. O navegador não libera microfone em HTTP comum de outro dispositivo; não existe correção segura apenas por CSS ou JavaScript para contornar essa regra.

### Limite de compartilhamento de tela em celulares
O compartilhamento via navegador usa a API padrão `navigator.mediaDevices.getDisplayMedia`, disponível em navegadores desktop compatíveis. Chrome para Android não oferece captura de tela por páginas web; nesse caso, o recurso precisa de uma implementação Android nativa (MediaProjection) para compartilhar a tela do aparelho. O site não tenta simular nem informar falsamente que a captura está ativa.


## Seleção de saída de áudio (Etapa 12.3)

O painel de dispositivos agora apresenta a saída padrão do aparelho e, quando o navegador oferece `HTMLMediaElement.setSinkId`, as saídas externas realmente enumeradas. Em navegadores Android que não oferecem essa API, a saída permanece controlada pelo seletor de áudio do próprio Android (por exemplo, Bluetooth/alto-falante). A página não consegue forçar uma rota de áudio que o navegador/sistema não disponibiliza.

## Preparação para APK com chamadas em segundo plano

Este ZIP continua sendo a versão web. Manter chamada e compartilhamento de tela ativos depois de sair da tela exige um aplicativo Android nativo/híbrido: o APK precisa de um serviço em primeiro plano (foreground service), notificação persistente de chamada, permissões de microfone e, para captura de tela, `MediaProjection` com consentimento do sistema. O WebView sozinho não garante isso quando o app vai para segundo plano ou é encerrado. A sinalização/WebRTC e as contas devem ficar em um servidor HTTPS remoto; não se deve embutir o servidor Node/SQLite local do Termux como backend de produção dentro do APK.
