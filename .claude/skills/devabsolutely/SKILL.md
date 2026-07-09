---
name: devabsolutely
description: "Central de referência do desenvolvedor absoluto — junta 14 repositórios essenciais do GitHub (design resources, roadmaps, clean code, algoritmos de entrevista, boas práticas de teste, CLI, ideias de projeto, livros grátis, APIs públicas, vagas BR) + stack tier-S de site/software de topo (Next.js, shadcn/ui, Radix) + motion & animação de nível premiado (Motion, GSAP, Lenis, Three.js, Motion Primitives, Aceternity, Magic UI) + catálogo full-stack de backend/APIs (FastAPI, NestJS, Django, Express, Supabase, Appwrite), automação/orquestração (n8n, Temporal, Airflow, Node-RED, Activepieces), geração de imagem/motion/3D (ComfyUI, Diffusers, InvokeAI, AUTOMATIC1111, Blender, Manim, Three.js, Lottie, Motion Canvas) e DevSecOps (Semgrep, Gitleaks, Trivy, OWASP ZAP, Wazuh, Nmap) — com as skills de UI/UX e frontend (impeccable, emil-design-eng, ui-ux-pro-max, dataviz) instaladas localmente. Use quando o usuário: pedir recursos de estudo, roadmap de carreira dev, ideias de projeto/app, boas práticas de clean code, preparação pra entrevista técnica, referências de design/frontend, cheatsheet de linha de comando, livros de programação, APIs públicas pra consumir, vagas de emprego, montar site/software/backend/automação/segurança de altíssimo nível, animações/motion/scroll premium, geração de imagem ou vídeo com IA, ou perguntar 'por onde começar' / 'que projeto fazer' / 'como monto a stack toda' na área de tech. Também para desenvolvimento full-stack completo combinando frontend, backend, automação, mídia e segurança num só lugar. Keywords: dev resources, learning roadmap, clean code, coding interview, project ideas, frontend, backend, API, UI, UX, design, motion, animation, scroll, GSAP, Lenis, Three.js, command line, free books, public APIs, jobs, automação, workflow, n8n, Temporal, DevSecOps, Semgrep, Gitleaks, Trivy, ZAP, ComfyUI, Stable Diffusion, estudar programação, carreira dev, tier-S, design system, awwwards, pipeline, skill ultra potente."
---

# Dev Absolutely — Central do Desenvolvedor Completo

Hub único que reúne os **14 repositórios de referência do GitHub**, a **stack tier-S de frontend/motion**, um **catálogo full-stack priorizado** (backend, automação, mídia AI, segurança) e as **skills de design/frontend já instaladas** neste projeto. Consulte por tema; recomende o recurso certo conforme a pergunta — e delegue trabalho real em vez de reinventar.

## Como usar

1. Identifique a intenção do usuário (estudo, projeto, entrevista, design, backend, automação, segurança, boas práticas...).
2. Aponte o(s) recurso(s) da tabela correspondente com o link oficial.
3. Para trabalho real de **UI/UX ou frontend**, delegue às skills instaladas abaixo em vez de reinventar.
4. Para stacks completas ("monta o produto todo"), combine uma peça de cada camada (ver **Pipelines recomendados**).

## Skills de design/frontend instaladas (delegar, não duplicar)

| Situação | Skill | Quando |
|----------|-------|--------|
| Construir/revisar/polir interface de produção | `impeccable` | Redesign, audit, polish, design system, componentes, motion — trabalho real de UI |
| Consulta rápida de estilo/paleta/tipografia | `ui-ux-pro-max` | 67 estilos, 96 paletas, 57 pares de fonte, 25 gráficos, 13 stacks |
| Filosofia de polish e micro-interações | `emil-design-eng` | Detalhes que fazem software "sentir certo", animação, craft |
| Gráficos e visualização de dados | `dataviz` | Qualquer chart/dashboard/plot |

Regra: pergunta é **fazer/revisar UI** → invoque `impeccable`. Pergunta é **referência de estilo** → `ui-ux-pro-max`.

## Stack tier-S (site/software de topo absoluto)

Quando o pedido é "nível mais alto possível" de site/produto. Não é sobre governo — é o padrão dos estúdios/times que fazem benchmark mundial.

### Stack recomendada
```
Next.js (App Router) + TypeScript
Tailwind v4 + shadcn/ui  (base Radix, acessível por padrão)
motion                    (animação — lib padrão BMAi)
Zod + tRPC / Server Actions  (type-safe ponta a ponta)
GSAP + Lenis + Three.js   (hero cinematográfico / scroll premium — só onde agrega)
```

### Base de componentes (acessível, nível SaaS sério)
| Recurso | Link | Pra quê |
|---------|------|---------|
| shadcn/ui | github.com/shadcn-ui/ui | Base de todo SaaS moderno. Radix embaixo, copy-paste, tens MCP |
| Radix UI | radix-ui.com | Primitivos acessíveis crus (WAI-ARIA) |
| Ariakit | ariakit.org | Componentes com foco em acessibilidade |

### Referência de gente que faz o topo real
| Fonte | Link | Pra quê |
|-------|------|---------|
| Vercel / Next.js | github.com/vercel/next.js | Padrão de perf + DX |
| Emil Kowalski (Sonner, Vaul) | github.com/emilkowalski | Motion/craft — tem skill `emil-design-eng` |
| Paco Coursey (cmdk, next-themes) | github.com/pacocoursey | Primitivos elegantes |
| Rauno Freiberg | rauno.me/craft | Micro-detalhes de interface |
| Aceternity UI | ui.aceternity.com | Componentes efeito "uau" |

### Qualidade que separa bom de topo
| Recurso | Link | Pra quê |
|---------|------|---------|
| Refactoring UI (Tailwind team) | refactoringui.com | Regra visual que 90% ignora |
| Every Layout | every-layout.dev | Layout CSS robusto |
| web.dev (Google) | web.dev | Perf / Core Web Vitals |
| axe-core | github.com/dequelabs/axe-core | Auditoria de acessibilidade automática |

### Design Systems de referência mundial (padrão-ouro a11y)
| Sistema | Link | Dono |
|---------|------|------|
| Gov.br DS | github.com/govbr-ds/govbr-ds | 🇧🇷 Federal Brasil — usar se público BR |
| GOV.UK Design System | github.com/alphagov/govuk-design-system | UK — referência mundial de clareza |
| U.S. Web Design System | github.com/uswds/uswds | EUA, WCAG AA embutido |

## Motion & Animação (nível premiado / Awwwards)

### Núcleo (motor de animação)
| Lib | Link | Pra quê |
|-----|------|---------|
| Motion | motion.dev | Padrão React. API 90% menor que GSAP, layout anim, gestos, `AnimatePresence`. Lib padrão BMAi. MIT |
| GSAP | gsap.com | Timeline pro, SVG, easing, ScrollTrigger. Grátis total desde 2025 (Webflow banca). Hero cinematográfico |
| React Spring | react-spring.dev | Física de mola, movimento orgânico |
| Anime.js | animejs.com | Leve, vanilla, CSS+JS. Projeto sem React |

### Scroll premium (stack vencedor Awwwards 2026)
**Lenis + GSAP ScrollTrigger + Three.js**
| Lib | Link | Pra quê |
|-----|------|---------|
| Lenis | github.com/darkroomengineering/lenis | Smooth scroll 2.13KB. Matou Locomotive Scroll (legado) |
| GSAP ScrollTrigger 4.0 | gsap.com/docs/v3/Plugins/ScrollTrigger | Auto-pinning, mobile decente |
| Three.js / R3F | github.com/pmndrs/react-three-fiber | 3D web (tem MCP Three.js) |
| CSS `view-timeline` | — | API nativa: scroll-anim sem JS pra casos simples. Usar quando dá, economiza peso |

Regra 2026: **mobile-first**. Scroll só-desktop tá fora.

### Componentes prontos (copy-paste, efeito "uau")
| Lib | Link | Foco |
|------|------|------|
| Motion Primitives | github.com/itsjwill/motion-primitives-website | 110+ componentes grátis Next.js. Alt. open source à Aceternity/Magic. Dock, Spotlight, glass, 3D |
| Aceternity UI | ui.aceternity.com | 200+ componentes pesados. 3D cards, beams, magnetic, partículas |
| Magic UI | magicui.design | Micro-interação polida, marketing. Beams, retro grid, neon. Light+dark |
| React Bits / Skiper UI | reactbits.dev | Leve, flair pontual |

### Skills locais de motion (usar)
- `emil-design-eng` — quando/como animar, micro-interação
- `impeccable` — decide motion no contexto do design real
- MCP `magic` (21st.dev) — gera componente animado na hora
- MCP Three.js — cena 3D

### Rota: landing tier-S com motion
1. Base **Next.js + shadcn/ui**
2. Scroll = **Lenis + GSAP ScrollTrigger**
3. Hero 3D = **Three.js/R3F** (só se agrega)
4. Componente pronto = **Motion Primitives** (grátis) ou **Aceternity**
5. Micro-interação/estado = **Motion**
6. Polish final = `impeccable` + `emil-design-eng`
7. Audit = Lighthouse + axe-core

Estratégia: **shadcn/ui de base, tempera com Aceternity/Magic/Motion Primitives onde precisa flair.** App = shadcn puro; landing = flair pesado.

## Catálogo full-stack priorizado (backend, automação, mídia AI, segurança)

Selecção de projectos maduros, integráveis via CLI/SDK/API/servidor local/Docker/MCP, cobrindo o que a stack tier-S de frontend não resolve sozinha. Todos os repositórios abaixo são oficiais (GitHub). Nota de licenciamento: **n8n** identifica-se como *fair-code* (não OSI puro); **Nmap** usa licença própria baseada em GPLv2 mas explicitamente incompatível com GPLv2 — tratados aqui como "similares úteis", não open-source estrito.

### Backend, APIs e plataformas aplicacionais
| Nome | Linguagem | Licença | Uso principal |
|------|-----------|---------|----------------|
| FastAPI (github.com/fastapi/fastapi) | Python | MIT | API de alta performance, tipagem + OpenAPI nativo |
| Django (github.com/django/django) | Python | BSD-3-Clause | App web completa, ORM/admin "batteries included" |
| NestJS (github.com/nestjs/nest) | TypeScript | MIT | Backend Node enterprise, arquitetura modular |
| Express (github.com/expressjs/express) | JavaScript | MIT | API minimalista, protótipos rápidos |
| Supabase (github.com/supabase/supabase) | TS / multiserviço | Apache-2.0 | Plataforma Postgres-first: auth, APIs, realtime, storage |
| Appwrite (github.com/appwrite/appwrite) | PHP/TS | BSD-3-Clause | Backend all-in-one (auth, DB, storage, functions, hosting) |

### Automação e orquestração
| Nome | Linguagem | Licença | Uso principal |
|------|-----------|---------|----------------|
| n8n (github.com/n8n-io/n8n) | TypeScript | fair-code | Automação visual + agentes AI, 1500+ integrações |
| Activepieces (github.com/activepieces/activepieces) | TypeScript | — | Automação AI-first extensível, forte em MCP |
| Node-RED (github.com/node-red/node-red) | JavaScript | Apache-2.0 | Low-code orientado a eventos, IoT/integrações |
| Apache Airflow (github.com/apache/airflow) | Python | Apache-2.0 | Orquestração de pipelines de dados agendados |
| Temporal (github.com/temporalio/temporal) | Go | MIT | Durable execution, workflows críticos e resilientes |

### Design gráfico, motion, 3D e geração de mídia AI
| Nome | Linguagem | Licença | Uso principal |
|------|-----------|---------|----------------|
| Blender (github.com/blender/blender) | C/C++/Python | GPLv3 | 3D, motion graphics, rendering, vídeo |
| Manim Community (github.com/ManimCommunity/manim) | Python | MIT | Animações explicativas/matemáticas por código |
| Lottie-web (github.com/airbnb/lottie-web) | JavaScript | MIT | Animações After Effects leves no browser |
| Motion Canvas (github.com/motion-canvas/motion-canvas) | TypeScript | MIT | Motion graphics programadas com preview live |
| Three.js (github.com/mrdoob/three.js) | JavaScript | — | 3D interativo no browser (WebGL/WebGPU) |
| ComfyUI (github.com/comfyanonymous/ComfyUI) | Python | GPL-3.0 | Motor/GUI modular de geração multimodal por grafos/nós |
| Diffusers (github.com/huggingface/diffusers) | Python/PyTorch | Apache-2.0 | Biblioteca programática de modelos de difusão (imagem/vídeo/áudio) |
| InvokeAI (github.com/invoke-ai/InvokeAI) | TS + Python | Apache-2.0 + adicional | Canvas/workflows de geração visual Stable Diffusion |
| AUTOMATIC1111 (github.com/AUTOMATIC1111/stable-diffusion-webui) | Python | AGPL-3.0 | WebUI Stable Diffusion mais adotada, extensões vastas |

### Cybersecurity e DevSecOps
| Nome | Linguagem | Licença | Uso principal |
|------|-----------|---------|----------------|
| Semgrep (github.com/semgrep/semgrep) | OCaml/Python | LGPL-2.1 | SAST multi-linguagem, regras declarativas, CI-friendly |
| Gitleaks (github.com/gitleaks/gitleaks) | Go | MIT | Detecção de segredos em git/CI, SARIF/JUnit/JSON |
| Trivy (github.com/aquasecurity/trivy) | Go | Apache-2.0 | Scan de vulnerabilidades/misconfig/SBOM em containers, IaC, repos |
| OWASP ZAP (github.com/zaproxy/zaproxy) | Java | Apache-2.0 | DAST para web apps, scans automáticos ou manuais |
| Wazuh (github.com/wazuh/wazuh) | C++/C/Python | GPLv2 | SIEM/XDR open-source, SOC, compliance, FIM |
| Nmap (github.com/nmap/nmap) | C/C++/Lua | licença própria (base GPLv2, incompatível) | Reconhecimento e auditoria de rede |

## Pipelines recomendados

Não construir uma skill gigante única — compor **peças cooperantes**: uma decide, outra executa, outra valida, outra monitoriza.

**1. Produto web (SaaS/plataforma):**
Next.js/Nuxt/Astro + FastAPI/NestJS/Supabase/Appwrite + n8n/Temporal + Semgrep/Trivy/Gitleaks/ZAP.
UI moderna + API rápida ou plataforma pronta + automação operacional + cobertura DevSecOps ponta a ponta. Forte para equipas pequenas/médias — reduz tempo de integração sem sacrificar extensibilidade.

**2. Produto visual / marketing / conteúdo:**
Astro ou Next.js + Tailwind + Storybook + Penpot + Motion Canvas/Lottie + ComfyUI/Diffusers.
Produz rápido websites, assets visuais, componentes documentados e animações consistentes, com geração de imagem assistida mas em fluxo controlado.

**3. Enterprise / robustez e auditoria:**
NestJS ou Django + Temporal ou Airflow + Appwrite/Supabase + Wazuh + Semgrep + Trivy + Gitleaks.
Temporal resolve workflows duráveis; Airflow domina pipelines agendados; Wazuh entra na camada SOC/XDR; Semgrep/Trivy/Gitleaks fecham o circuito de segurança em código e artefactos.

### Fluxo de gate de segurança (DevSecOps contínuo)
```
Commit/PR → hooks (lint + testes + build) → Semgrep + Gitleaks + Trivy (gate de segurança)
→ build de artefacto → deploy staging → OWASP ZAP em staging → promover para produção
→ monitorização/logs/métricas → Wazuh/alertas → n8n/Temporal para remediação automatizada
```

## Roteamento rápido

- "Por onde começo?" → Developer Roadmap
- "Que projeto faço?" → App Ideas / Challenges
- "Vou fazer entrevista" → Coding Interview University
- "Melhorar meu código" → Clean Code (por linguagem) + `impeccable` se for UI
- "Quero ler/estudar" → Free Programming Books
- "Preciso de uma API" → Public APIs
- "Terminal/Linux" → The Art of Command Line
- "Design/UI" → `impeccable` + `ui-ux-pro-max` + Design Resources
- "Site/software de altíssimo nível" → seção **Stack tier-S**
- "Animação / motion / scroll premium" → seção **Motion & Animação**
- "Componente com efeito uau" → Motion Primitives / Aceternity / Magic UI + MCP `magic`
- "Design system / acessibilidade nível topo" → shadcn/ui + Radix + axe-core; Gov.br DS se público BR
- "Backend/API" → FastAPI (Python) ou NestJS (TS); Supabase/Appwrite se quiser plataforma pronta
- "Automação / workflow / agente" → n8n (rápido) ou Temporal (crítico/durável)
- "Gerar imagem/vídeo com IA" → ComfyUI (workflows visuais) + Diffusers (programático)
- "Auditoria de segurança / gate de CI" → Semgrep + Gitleaks + Trivy; ZAP em staging; Wazuh em produção
- "Monta o produto todo" → ver **Pipelines recomendados** acima
- "Procurando vaga" → repos de Vagas BR (ver issues)

## Os 14 repositórios

### Design & Frontend
| Repo | Link | Pra quê |
|------|------|---------|
| Design Resources for Developers | github.com/bradtraversy/design-resources-for-developers | Fotos, ícones, CSS libs, componentes React/Vue grátis |
| GitHub Readme Stats | github.com/anuraghazra/github-readme-stats | Cards de stats no perfil GitHub |

### Roadmap & Carreira
| Repo | Link | Pra quê |
|------|------|---------|
| Developer Roadmap | github.com/kamranahmedse/developer-roadmap | Trilhas Front/Back/DevOps atualizadas por ano |
| Coding Interview University | github.com/jwasham/coding-interview-university | Prep completo pra entrevista (Google/Amazon/Meta/MS) |

### Boas práticas & Clean Code
| Repo | Link | Pra quê |
|------|------|---------|
| Clean Code JavaScript | github.com/ryanmcdermott/clean-code-javascript | Código limpo em JS |
| Clean Code PHP | github.com/jupeter/clean-code-php | Código limpo em PHP |
| Clean Code .NET | github.com/thangchung/clean-code-dotnet | Código limpo em C#/.NET |
| Clean Code TypeScript | github.com/labs42io/clean-code-typescript | Código limpo em TS |
| Clean Code Ruby | github.com/uohzxela/clean-code-ruby | Código limpo em Ruby |
| JavaScript Testing Best Practices | github.com/goldbergyoni/javascript-testing-best-practices | Boas práticas de teste JS/Node (tem PT) |

### Estudo & Ferramentas
| Repo | Link | Pra quê |
|------|------|---------|
| Free Programming Books | github.com/EbookFoundation/free-programming-books | Livros grátis, vários idiomas/temas |
| The Art of Command Line | github.com/jlevy/the-art-of-command-line | Domínio do terminal Linux (tem PT) |
| Public APIs | github.com/public-apis/public-apis | APIs públicas por tema, com/sem auth |
| Awesome Hacking Resources | github.com/vitalysim/Awesome-Hacking-Resources | Segurança da informação, malware, forums |

### Projetos & Prática
| Repo | Link | Pra quê |
|------|------|---------|
| App Ideas Collection | github.com/florinpop17/app-ideas | Ideias de projeto por nível + to-do de requisitos |
| Frontend Challenges | github.com/felipefialho/frontend-challenges | Desafios reais de empresas (front) |
| Backend Challenges | github.com/felipefialho/backend-challenges | Desafios reais de empresas (back) |

### Vagas & Primeiro emprego (comunidades BR — vagas nas *issues*)
| Repo | Link |
|------|------|
| Frontend BR | github.com/frontendbr/vagas |
| Backend BR | github.com/backend-br/vagas |
| Flutter BR | github.com/flutterbrasil/vagas |
| React BR | github.com/reactbrasil/vagas |
| Vue BR | github.com/vuejs-br/vagas |
| SouJava | github.com/soujava/vagas-java |
| Contrate um Júnior (Aline Bastos) | github.com/alinebastos/contrate-um-junior |

> Nota: handles/nomes de repo mudam com o tempo. Se um link der 404, buscar o repositório atual pelo nome. Licenças/estrelas variam com o tempo — confirmar na fonte oficial antes de assumir.
