import { useCallback, useEffect, useState, type FormEvent } from "react";

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
}

// Vazio quando front e API rodam juntos — mesma convenção do resto do sistema.
const API_URL = import.meta.env.VITE_API_URL ?? "";
// Seguro pollar: GET /api/embalagem pro dia de hoje só lê cache no servidor, nunca chama o Tiny
// direto (ver lib/embalagem.ts) — quem chama o Tiny é só o job de fundo, numa frequência própria.
// Mesmo intervalo do painel de separação (src/App.tsx).
const POLL_MS = 30_000;

function hojeBr(): string {
  return new Date().toLocaleDateString("pt-BR");
}

function extrairErro(json: unknown, fallback: string): string {
  if (json && typeof json === "object" && "erro" in json && typeof (json as { erro: unknown }).erro === "string") {
    return (json as { erro: string }).erro;
  }
  return fallback;
}

export function Embalagem() {
  const [dia, setDia] = useState(hojeBr());
  const [desempenho, setDesempenho] = useState<DesempenhoEmbalagem | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const [colaboradores, setColaboradores] = useState<ColaboradorEmbalagem[]>([]);
  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [novoId, setNovoId] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [erroConfig, setErroConfig] = useState<string | null>(null);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  // ID original de quem está sendo editado agora (null = formulário em modo "adicionar"). Guarda
  // o ID de ANTES da edição porque, se a pessoa também trocar o ID no formulário, precisa remover
  // o registro antigo depois de salvar o novo — o Tiny não tem conceito de "renomear uma chave".
  const [editandoIdOriginal, setEditandoIdOriginal] = useState<string | null>(null);

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
    setErroConfig(null);
  }, []);

  const iniciarEdicao = useCallback((colaborador: ColaboradorEmbalagem) => {
    setEditandoIdOriginal(colaborador.idUsuarioEmbalador);
    setNovoId(colaborador.idUsuarioEmbalador);
    setNovoNome(colaborador.nome);
    setErroConfig(null);
  }, []);

  const salvarColaborador = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setErroConfig(null);
      setSalvandoConfig(true);
      try {
        const response = await fetch(`${API_URL}/api/embalagem/colaboradores`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idUsuarioEmbalador: novoId, nome: novoNome }),
        });
        const json = await response.json();
        if (!response.ok) throw new Error(extrairErro(json, "Não consegui salvar o colaborador."));

        // Editando e o ID mudou: o registro antigo não se renomeia, fica um cadastro separado se
        // não remover — limpa ele depois de confirmar que o novo já foi salvo.
        if (editandoIdOriginal && editandoIdOriginal !== novoId.trim()) {
          await fetch(`${API_URL}/api/embalagem/colaboradores/${encodeURIComponent(editandoIdOriginal)}`, { method: "DELETE" });
        }

        cancelarEdicao();
        await carregarColaboradores();
      } catch (error) {
        setErroConfig(error instanceof Error ? error.message : "Não consegui salvar o colaborador.");
      } finally {
        setSalvandoConfig(false);
      }
    },
    [novoId, novoNome, editandoIdOriginal, cancelarEdicao, carregarColaboradores],
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

  return (
    <div className="page pagina-formulario pagina-formulario--larga">
      <header className="header">
        <h1 className="title">Controle de Tempo de Embalagem</h1>
      </header>

      <form className="busca-linha" onSubmit={(event) => event.preventDefault()}>
        <label className="field">
          <span className="field-label">Dia</span>
          <input className="field-input" value={dia} onChange={(event) => setDia(event.target.value)} placeholder="dd/mm/aaaa" />
        </label>
        <button className="refresh-btn" type="button" onClick={() => setDia(hojeBr())}>
          Hoje
        </button>
        <button className="refresh-btn" type="button" onClick={() => void carregarDesempenho(dia)} disabled={carregando}>
          {carregando ? "Atualizando..." : "Atualizar"}
        </button>
      </form>

      {erro && <p className="error-banner">{erro}</p>}

      {desempenho && (
        <>
          <p className="nota-info">
            Atualizado às {new Date(desempenho.atualizadoEm).toLocaleTimeString("pt-BR")}
            {!desempenho.completo ? " — ainda sincronizando com o Tiny, os números vão completar nas próximas atualizações." : ""}
            {desempenho.naoIdentificados > 0
              ? ` · ${desempenho.naoIdentificados} pedido(s) embalado(s) sem identificação de quem embalou (campo não veio do Tiny).`
              : ""}
          </p>

          <div className="tabela-wrap">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Colaborador</th>
                  <th>Pedidos</th>
                  <th>Pedidos/Hora</th>
                  <th>Tempo</th>
                </tr>
              </thead>
              <tbody>
                {desempenho.colaboradores.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="field-value--muted">
                      Nenhum pedido embalado nesse dia ainda.
                    </td>
                  </tr>
                ) : (
                  desempenho.colaboradores.map((colaborador) => (
                    <tr key={colaborador.idUsuarioEmbalador}>
                      <td>{colaborador.nome}</td>
                      <td>{colaborador.pedidos}</td>
                      <td>{colaborador.pedidosPorHora}</td>
                      <td>{colaborador.tempoFormatado}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td>TOTAL</td>
                  <td>{desempenho.totalPedidos}</td>
                  <td>—</td>
                  <td>{desempenho.totalTempoFormatado}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      <button className="nav-corner-item" onClick={() => setMostrarConfig((atual) => !atual)}>
        {mostrarConfig ? "Esconder colaboradores" : "Configurar colaboradores"}
      </button>

      {mostrarConfig && (
        <div className="estoque-vazio">
          <p className="estoque-vazio-titulo">Colaboradores cadastrados</p>
          <p className="field-value--muted">
            O Tiny identifica quem embalou por um ID numérico (`idUsuarioEmbalador`), não pelo nome — cadastre aqui qual ID
            corresponde a qual colaborador. Um ID sem cadastro aparece no relatório como "ID 12345 (sem nome cadastrado)".
          </p>

          <div className="tabela-wrap">
            <table className="tabela">
              <thead>
                <tr>
                  <th>ID no Tiny</th>
                  <th>Nome</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {colaboradores.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="field-value--muted">
                      Nenhum colaborador cadastrado ainda.
                    </td>
                  </tr>
                ) : (
                  colaboradores.map((colaborador) => (
                    <tr key={colaborador.idUsuarioEmbalador} className={editandoIdOriginal === colaborador.idUsuarioEmbalador ? "tabela-linha--editando" : undefined}>
                      <td>{colaborador.idUsuarioEmbalador}</td>
                      <td>{colaborador.nome}</td>
                      <td className="tabela-acoes">
                        <button type="button" className="refresh-btn" onClick={() => iniciarEdicao(colaborador)}>
                          Editar
                        </button>
                        <button type="button" className="refresh-btn" onClick={() => void removerColaborador(colaborador.idUsuarioEmbalador)}>
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <form className="busca-linha" onSubmit={salvarColaborador}>
            <label className="field">
              <span className="field-label">ID do usuário no Tiny</span>
              <input className="field-input" value={novoId} onChange={(event) => setNovoId(event.target.value)} placeholder="Ex: 449251343" />
            </label>
            <label className="field">
              <span className="field-label">Nome do colaborador</span>
              <input className="field-input" value={novoNome} onChange={(event) => setNovoNome(event.target.value)} placeholder="Ex: Geovane" />
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
      )}
    </div>
  );
}
