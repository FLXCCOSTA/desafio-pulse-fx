import { Link, Route, Routes } from 'react-router-dom';

import { Dashboard } from './pages/Dashboard';
import { IndicatorDetail } from './pages/IndicatorDetail';

export function App(): React.JSX.Element {
  return (
    <>
      {/* Primeiro elemento focável da página: quem navega por teclado pula o
          cabeçalho em vez de tabular por ele em toda visita. */}
      <a className="skip-link" href="#conteudo">
        Ir para o conteúdo
      </a>

      <div className="shell">
        <header className="masthead">
          <Link className="wordmark" to="/">
            Pulse<span>FX</span>
          </Link>
          <span className="masthead-note">Câmbio e macro · BCB e FRED</span>
        </header>

        {/* Exigido pelo briefing e, mais que isso, correto: o produto mostra
            dado público com fim educacional e não recomenda investimento. */}
        <aside className="disclaimer">
          <span aria-hidden="true">ⓘ</span>
          <p style={{ margin: 0 }}>
            <strong>Conteúdo educacional.</strong> Os dados vêm de fontes públicas oficiais e
            são exibidos para fins informativos. Isto <strong>não</strong> é recomendação de
            investimento, nem cotação para operação de câmbio.
          </p>
        </aside>

        <main id="conteudo">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/indicador/:id" element={<IndicatorDetail />} />
            <Route
              path="*"
              element={
                <div className="state">
                  <h2>Página não encontrada</h2>
                  <p>O endereço acessado não existe neste painel.</p>
                  <p style={{ marginTop: 18 }}>
                    <Link className="button" to="/">
                      Voltar ao painel
                    </Link>
                  </p>
                </div>
              }
            />
          </Routes>
        </main>

        <footer className="foot">
          <p>
            Fontes: <a href="https://dadosabertos.bcb.gov.br/" target="_blank" rel="noreferrer noopener">Banco Central do Brasil</a>
            {' · '}
            <a href="https://fred.stlouisfed.org/" target="_blank" rel="noreferrer noopener">FRED, Federal Reserve Bank of St. Louis</a>.
          </p>
          <p>Pulse FX — projeto de desafio técnico, sem finalidade comercial.</p>
        </footer>
      </div>
    </>
  );
}
