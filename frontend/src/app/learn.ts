import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface NcmItem { Codigo: string; Descricao: string; }

@Component({
  selector: 'app-learn',
  imports: [CommonModule, FormsModule],
  templateUrl: './learn.html',
  styleUrl: './learn.scss',
})
export class Learn {
  query = '';
  source = '';
  loading = true;
  error = '';
  searched = false;
  results: NcmItem[] = [];
  private entries: NcmItem[] = [];
  checked = [false, false, false, false];
  answer: number | null = null;
  readonly steps = [
    'Descrever o produto, seu material e sua finalidade.',
    'Pesquisar a NCM e conferir a descrição na fonte oficial.',
    'Conferir a operação, a UF e o regime com apoio contábil.',
    'Comparar custo, taxas e preço antes de vender.',
  ];
  constructor() { void this.load(); }
  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const response = await fetch('data/ncm-siscomex.json');
      if (!response.ok) throw new Error();
      const data = await response.json();
      this.source = `${data.Data_Ultima_Atualizacao_NCM} · ${data.Ato}`;
      this.entries = data.Nomenclaturas
        .filter((x: NcmItem) => x.Codigo.replace(/\D/g, '').length === 8)
        .map((x: NcmItem) => ({ ...x, Descricao: x.Descricao.replace(/<[^>]+>/g, '').replace(/^-+\s*/, '') }));
    } catch { this.error = 'Não foi possível abrir a tabela. Tente carregar novamente.'; }
    finally { this.loading = false; }
  }
  private normalize(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
  search(): void {
    this.searched = true;
    const query = this.normalize(this.query.trim());
    const digits = query.replace(/\D/g, '');
    const tokens = query.split(/\s+/).filter(Boolean);
    this.results = query.length < 3 ? [] : this.entries.filter(x => {
      if (/^[\d.]+$/.test(query)) return x.Codigo.replace(/\D/g, '').startsWith(digits);
      return tokens.every(t => this.normalize(x.Descricao).includes(t));
    }).slice(0, 12);
  }
  example(value: string): void { this.query = value; this.search(); }
  get progress(): number { return this.checked.filter(Boolean).length; }
  download(): void {
    const text = 'Tributo em Foco — meu roteiro de cadastro\n\n' +
      this.steps.map((s, i) => `${this.checked[i] ? '[x]' : '[ ]'} ${s}`).join('\n') +
      '\n\nPesquisa: ' + (this.query || 'Ainda não realizada') +
      '\n' + this.results.map(x => `${x.Codigo} — ${x.Descricao}`).join('\n') +
      '\n\nBase local: ' + this.source +
      '\nConsulta oficial: https://portalunico.siscomex.gov.br/classif/\n' +
      'As correspondências precisam de conferência. A NCM, sozinha, não determina a tributação.\n';
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'meu-roteiro-de-cadastro.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
