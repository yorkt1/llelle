import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "@/PageHeader";

interface DesempenhoColaborador {
  idUsuarioEmbalador: string;
  nome: string;
  pedidos: number;
  pedidosPorHora: number;
  horas: number;
  tempoFormatado: string;
}

interface DesempenhoEmbalagem {
  dia: string;
  colaboradores: DesempenhoColaborador[];
  totalPedidos: number;
  totalHoras: number;
  totalTempoFormatado: string;
  naoIdentificados: number;
  completo: boolean;
  atualizadoEm: string;
}

interface ColaboradorEmbalagem {
  idUsuarioEmbalador: string;
  nome: string;
  bancada?: string;
}

// Vazio quando front e API rodam juntos — mesma convenção do resto do sistema.
const API_URL = import.meta.env.VITE_API_URL ?? "";
// Seguro pollar: GET /api/embalagem pro dia de hoje só lê cache no servidor, nunca chama o Tiny
// direto (ver lib/embalagem.ts) — quem chama o Tiny é só o job de fundo, numa frequência própria.
// Mesmo intervalo do painel de separação (src/App.tsx).
const POLL_MS = 30_000;
const NOME_MAX_LENGTH = 100;

function hojeBr(): string {
  return new Date().toLocaleDateString("pt-BR");
}

function extrairErro(json: unknown, fallback: string): string {
  if (json && typeof json === "object" && "erro" in json && typeof (json as { erro: unknown }).erro === "string") {
    return (json as { erro: string }).erro;
  }
  return fallback;
}

/** Primeiros dígitos + "…" — o ID completo (idUsuarioEmbalador) não diz nada pra quem lê, só serve de referência. */
function abreviarId(id: string): string {
  return id.length > 4 ? `${id.slice(0, 4)}…` : id;
}

function IconeEditar({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M4 20h4L19.5 8.5a2 2 0 0 0 0-2.83l-1.17-1.17a2 2 0 0 0-2.83 0L4 16v4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconeExcluir({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconeConfig({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconeAviso({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Embalagem() {
  const [dia, setDia] = useState(hojeBr());
  const [desempenho, setDesempenho] = useState<DesempenhoEmbalagem | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const [colaboradores, setColaboradores] = useState<ColaboradorEmbalagem[]>([]);
  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [mostrarSaibaMais, setMostrarSaibaMais] = useState(false);
  const [novoId, setNovoId] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novaBancada, setNovaBancada] = useState("");
  const [erroConfig, setErroConfig] = useState<string | null>(null);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const idInputRef = useRef<HTMLInputElement>(null);
  // ID original de quem está sendo editado agora (null = formulário em modo "adicionar"). Guarda
  // o ID de ANTES da edição porque, se a pessoa também trocar o ID no formulário, precisa remover
  // o registro antigo depois de salvar o novo — o Tiny não tem conceito de "renomear uma chave".
  const [editandoIdOriginal, setEditandoIdOriginal] = useState<string | null>(null);

  const colaboradorPorId = useMemo(() => new Map(colaboradores.map((c) => [c.idUsuarioEmbalador, c])), [colaboradores]);

  // Painel fixo por bancada (pra visualização em TV) — uma bancada por colaborador cadastrado com
  // esse campo preenchido, ordenadas numericamente. Não é fixo em "1 a 4": se cadastrar uma bancada
  // 5, ela aparece também, só continua no mesmo grid de 2 colunas e letra grande.
  const colaboradorPorBancada = useMemo(() => {
    const mapa = new Map<string, ColaboradorEmbalagem>();
    for (const c of colaboradores) {
      if (c.bancada && !mapa.has(c.bancada)) mapa.set(c.bancada, c);
    }
    return mapa;
  }, [colaboradores]);

  const bancadas = useMemo(
    () => Array.from(colaboradorPorBancada.keys()).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)),
    [colaboradorPorBancada],
  );

  const desempenhoPorId = useMemo(
    () => new Map((desempenho?.colaboradores ?? []).map((d) => [d.idUsuarioEmbalador, d])),
    [desempenho],
  );

  // Quem embalou hoje mas não está numa bancada (sem cadastro, ou cadastrado sem bancada) — não
  // pode desaparecer só porque não cabe no grid fixo, então sobra numa lista simples embaixo.
  const desempenhoSemBancada = useMemo(() => {
    if (!desempenho) return [];
    return desempenho.colaboradores.filter((d) => {
      const registrado = colaboradorPorId.get(d.idUsuarioEmbalador);
      return !registrado?.bancada;
    });
  }, [desempenho, colaboradorPorId]);

  const carregarDesempenho = useCallback(async (diaConsultado: string) => {
    setCarregando(true);
    try {
      const response = await fetch(`${API_URL}/api/embalagem?dia=${encodeURIComponent(diaConsultado)}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(extrairErro(json, "Não consegui calcular o desempenho de embalagem."));
      setDesempenho(json as DesempenhoEmbalagem);
      setErro(null);
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : "Não consegui calcular o desempenho de embalagem.";
      const horario = new Date().toLocaleTimeString("pt-BR");
      setErro(`${mensagem} (tentativa às ${horario})`);
    } finally {
      setCarregando(false);
    }
  }, []);

  const carregarColaboradores = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/embalagem/colaboradores`, { cache: "no-store" });
      const json = await response.json();
      if (response.ok) setColaboradores(json.colaboradores ?? []);
    } catch {
      // Lista de colaboradores é só pra tela de configuração — uma falha aqui não trava o relatório.
    }
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => void carregarColaboradores(), 0);
    return () => clearTimeout(kickoff);
  }, [carregarColaboradores]);

  // Reconsulta ao trocar o dia, e continua atualizando em intervalo — seguro agora que o GET só
  // lê cache no servidor (ver comentário em POLL_MS). O botão "Atualizar" ao lado cobre quem quer
  // forçar uma olhada na hora, sem esperar o próximo tick.
  useEffect(() => {
    const kickoff = setTimeout(() => void carregarDesempenho(dia), 0);
    const id = setInterval(() => void carregarDesempenho(dia), POLL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [dia, carregarDesempenho]);

  const cancelarEdicao = useCallback(() => {
    setEditandoIdOriginal(null);
    setNovoId("");
    setNovoNome("");
    setNovaBancada("");
    setErroConfig(null);
  }, []);

  const iniciarEdicao = useCallback((colaborador: ColaboradorEmbalagem) => {
    setEditandoIdOriginal(colaborador.idUsuarioEmbalador);
    setNovoId(colaborador.idUsuarioEmbalador);
    setNovoNome(colaborador.nome);
    setNovaBancada(colaborador.bancada ?? "");
    setErroConfig(null);
  }, []);

  /** Clique no badge "Cadastrar" de um card sem nome — abre o painel já com o ID preenchido. */
  const abrirCadastroComId = useCallback((idUsuarioEmbalador: string) => {
    setMostrarConfig(true);
    setEditandoIdOriginal(null);
    setNovoId(idUsuarioEmbalador);
    setNovoNome("");
    setNovaBancada("");
    setErroConfig(null);
  }, []);

  const salvarColaborador = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setErroConfig(null);

      const idLimpo = novoId.trim();
      const nomeLimpo = novoNome.trim();
      if (!idLimpo) {
        setErroConfig("Informe o ID do usuário no Tiny.");
        return;
      }
      if (!/^\d+$/.test(idLimpo)) {
        setErroConfig("O ID deve conter apenas números.");
        return;
      }
      if (!nomeLimpo) {
        setErroConfig("Informe o nome do colaborador.");
        return;
      }
      if (nomeLimpo.length > NOME_MAX_LENGTH) {
        setErroConfig(`O nome pode ter no máximo ${NOME_MAX_LENGTH} caracteres.`);
        return;
      }
      if (!editandoIdOriginal && colaboradorPorId.has(idLimpo)) {
        setErroConfig("Esse ID já está cadastrado.");
        return;
      }

      setSalvandoConfig(true);
      try {
        const response = await fetch(`${API_URL}/api/embalagem/colaboradores`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idUsuarioEmbalador: idLimpo, nome: nomeLimpo, bancada: novaBancada }),
        });
        const json = await response.json();
        if (!response.ok) throw new Error(extrairErro(json, "Não consegui salvar o colaborador."));

        // Editando e o ID mudou: o registro antigo não se renomeia, fica um cadastro separado se
        // não remover — limpa ele depois de confirmar que o novo já foi salvo.
        if (editandoIdOriginal && editandoIdOriginal !== idLimpo) {
          await fetch(`${API_URL}/api/embalagem/colaboradores/${encodeURIComponent(editandoIdOriginal)}`, { method: "DELETE" });
        }

        cancelarEdicao();
        await carregarColaboradores();
      } catch (error) {
        // Mantém o que a pessoa digitou — só a mensagem de erro aparece, o formulário não limpa.
        setErroConfig(error instanceof Error ? error.message : "Não consegui salvar o colaborador.");
      } finally {
        setSalvandoConfig(false);
      }
    },
    [novoId, novoNome, novaBancada, editandoIdOriginal, colaboradorPorId, cancelarEdicao, carregarColaboradores],
  );

  const removerColaborador = useCallback(
    async (idUsuarioEmbalador: string) => {
      setErroConfig(null);
      try {
        const response = await fetch(`${API_URL}/api/embalagem/colaboradores/${encodeURIComponent(idUsuarioEmbalador)}`, { method: "DELETE" });
        if (!response.ok) throw new Error("Não consegui remover esse colaborador agora.");
        if (editandoIdOriginal === idUsuarioEmbalador) cancelarEdicao();
        await carregarColaboradores();
      } catch (error) {
        setErroConfig(error instanceof Error ? error.message : "Não consegui remover esse colaborador agora.");
      }
    },
    [carregarColaboradores, editandoIdOriginal, cancelarEdicao],
  );

  const confirmarERemover = useCallback(
    (colaborador: ColaboradorEmbalagem) => {
      if (!window.confirm(`Remover "${colaborador.nome}" da lista de colaboradores?`)) return;
      void removerColaborador(colaborador.idUsuarioEmbalador);
    },
    [removerColaborador],
  );

  return (
    <div className="page pagina-formulario">
      <PageHeader titulo="Controle de Tempo de Embalagem">
        <button type="button" className="refresh-btn refresh-btn--icone" onClick={() => setMostrarConfig((atual) => !atual)}>
          <IconeConfig className="btn-icone" />
          {mostrarConfig ? "Esconder colaboradores" : "Configurar colaboradores"}
        </button>
      </PageHeader>

      <form className="busca-linha busca-linha--alinhada" onSubmit={(event) => event.preventDefault()}>
        <label className="field">
          <span className="field-label">Dia</span>
          <input className="field-input" value={dia} onChange={(event) => setDia(event.target.value)} placeholder="dd/mm/aaaa" />
        </label>
        <button className="refresh-btn" type="button" onClick={() => setDia(hojeBr())}>
          Hoje
        </button>
        <button className="btn-primario" type="button" onClick={() => void carregarDesempenho(dia)} disabled={carregando}>
          {carregando ? "Atualizando..." : "Atualizar"}
        </button>
      </form>

      {erro && <p className="error-banner">{erro}</p>}

      {desempenho && (
        <>
          <p className="nota-info nota-info--aviso">
            {!desempenho.completo && <IconeAviso className="nota-info-icone" />}
            Atualizado às {new Date(desempenho.atualizadoEm).toLocaleTimeString("pt-BR")}
            {!desempenho.completo ? " — ainda sincronizando com o Tiny, os números vão completar nas próximas atualizações." : ""}
            {desempenho.naoIdentificados > 0
              ? ` · ${desempenho.naoIdentificados} pedido(s) embalado(s) sem identificação de quem embalou (campo não veio do Tiny).`
              : ""}
          </p>

          {bancadas.length === 0 ? (
            <div className="estado-vazio">
              <p className="estado-vazio-titulo">Nenhuma bancada cadastrada ainda.</p>
              <p className="field-value--muted">Preencha o campo Bancada de quem embala no cadastro de colaboradores.</p>
              {!mostrarConfig && (
                <button type="button" className="btn-primario" onClick={() => setMostrarConfig(true)}>
                  Cadastrar bancadas
                </button>
              )}
            </div>
          ) : (
            <div className="bancada-grid">
              {bancadas.map((bancada) => {
                const registrado = colaboradorPorBancada.get(bancada);
                const dados = registrado ? desempenhoPorId.get(registrado.idUsuarioEmbalador) : undefined;
                return (
                  <div key={bancada} className="bancada-card">
                    <h3 className="bancada-card-titulo">Bancada {bancada}</h3>
                    <p className="bancada-card-nome">{registrado?.nome ?? "Sem colaborador"}</p>
                    <div className="bancada-card-stats">
                      <div className="bancada-card-stat">
                        <span className="bancada-card-valor">{dados?.pedidos ?? 0}</span>
                        <span className="bancada-card-label">Bipados</span>
                      </div>
                      <div className="bancada-card-stat">
                        <span className="bancada-card-valor">{dados?.pedidosPorHora ?? 0}</span>
                        <span className="bancada-card-label">Pedidos Hora</span>
                      </div>
                      <div className="bancada-card-stat">
                        <span className="bancada-card-valor">{dados?.tempoFormatado ?? "0h 00min"}</span>
                        <span className="bancada-card-label">Tempo</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="bancada-total">
            total: {desempenho.totalPedidos} pedidos · {desempenho.totalTempoFormatado}
          </p>

          {desempenhoSemBancada.length > 0 && (
            <div className="embalagem-grid embalagem-grid--secundario">
              <p className="embalagem-grid-titulo">Sem bancada cadastrada</p>
              {desempenhoSemBancada.map((colaborador) => {
                const registrado = colaboradorPorId.get(colaborador.idUsuarioEmbalador);
                return (
                  <div key={colaborador.idUsuarioEmbalador} className="embalagem-card">
                    {registrado ? (
                      <h3 className="embalagem-card-nome" title={registrado.nome}>
                        {registrado.nome}
                      </h3>
                    ) : (
                      <>
                        <h3 className="embalagem-card-nome">Sem nome</h3>
                        <button
                          type="button"
                          className="embalagem-card-badge"
                          onClick={() => abrirCadastroComId(colaborador.idUsuarioEmbalador)}
                        >
                          Cadastrar · ID {abreviarId(colaborador.idUsuarioEmbalador)}
                        </button>
                      </>
                    )}
                    <div className="embalagem-card-stats">
                      <div className="embalagem-card-stat">
                        <span className="embalagem-card-valor">{colaborador.pedidos}</span>
                        <span className="embalagem-card-label">Pedidos</span>
                      </div>
                      <div className="embalagem-card-stat">
                        <span className="embalagem-card-valor">{colaborador.pedidosPorHora}</span>
                        <span className="embalagem-card-label">Pedidos/Hora</span>
                      </div>
                      <div className="embalagem-card-stat">
                        <span className="embalagem-card-valor">{colaborador.tempoFormatado}</span>
                        <span className="embalagem-card-label">Tempo</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {mostrarConfig && (
        <div className="colab-painel">
          <div className="colab-painel-info">
            <p className="estoque-vazio-titulo">Colaboradores cadastrados</p>
            <p className="field-value--muted">
              O Tiny identifica quem embalou por um ID numérico, não pelo nome.
              {mostrarSaibaMais && (
                <>
                  {" "}
                  Cadastre aqui qual ID (`idUsuarioEmbalador`) corresponde a qual colaborador, e opcionalmente a bancada dele —
                  assim a tela mostra o nome em vez do ID cru. Um ID sem cadastro aparece no relatório como "Sem nome".
                </>
              )}
            </p>
            <button type="button" className="colab-saibamais" onClick={() => setMostrarSaibaMais((atual) => !atual)}>
              {mostrarSaibaMais ? "Mostrar menos" : "Saiba mais"}
            </button>

            <div className="tabela-wrap">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nome</th>
                    <th>Bancada</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {colaboradores.length === 0 ? (
                    <tr>
                      <td colSpan={4}>
                        <div className="estado-vazio estado-vazio--compacto">
                          <p className="estado-vazio-titulo">Nenhum colaborador cadastrado ainda.</p>
                          <button type="button" className="btn-primario" onClick={() => idInputRef.current?.focus()}>
                            Cadastrar o primeiro
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    colaboradores.map((colaborador) => (
                      <tr
                        key={colaborador.idUsuarioEmbalador}
                        className={editandoIdOriginal === colaborador.idUsuarioEmbalador ? "tabela-linha--editando" : undefined}
                      >
                        <td>{colaborador.idUsuarioEmbalador}</td>
                        <td>{colaborador.nome}</td>
                        <td>{colaborador.bancada || "—"}</td>
                        <td className="tabela-acoes">
                          <button type="button" className="refresh-btn refresh-btn--icone" onClick={() => iniciarEdicao(colaborador)}>
                            <IconeEditar className="btn-icone" />
                            Editar
                          </button>
                          <button type="button" className="refresh-btn refresh-btn--icone" onClick={() => confirmarERemover(colaborador)}>
                            <IconeExcluir className="btn-icone" />
                            Excluir
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="colab-painel-form-card">
            <h3 className="colab-painel-form-titulo">{editandoIdOriginal ? "Editar colaborador" : "Novo colaborador"}</h3>
            <form className="colab-form" onSubmit={salvarColaborador}>
              <label className="field">
                <span className="field-label">ID do usuário no Tiny</span>
                <input
                  ref={idInputRef}
                  className="field-input"
                  inputMode="numeric"
                  value={novoId}
                  onChange={(event) => setNovoId(event.target.value)}
                  placeholder="Ex: 449251343"
                />
              </label>
              <label className="field">
                <span className="field-label">Nome do colaborador</span>
                <input
                  className="field-input"
                  value={novoNome}
                  onChange={(event) => setNovoNome(event.target.value)}
                  placeholder="Ex: Geovane"
                  maxLength={NOME_MAX_LENGTH}
                />
              </label>
              <label className="field">
                <span className="field-label">Bancada (opcional)</span>
                <input className="field-input" value={novaBancada} onChange={(event) => setNovaBancada(event.target.value)} placeholder="Ex: 03" />
              </label>
              <button className="btn-primario" type="submit" disabled={salvandoConfig}>
                {salvandoConfig ? "Salvando..." : editandoIdOriginal ? "Salvar alteração" : "Adicionar"}
              </button>
              {editandoIdOriginal && (
                <button type="button" className="refresh-btn" onClick={cancelarEdicao}>
                  Cancelar
                </button>
              )}
            </form>

            {erroConfig && <p className="error-banner">{erroConfig}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
