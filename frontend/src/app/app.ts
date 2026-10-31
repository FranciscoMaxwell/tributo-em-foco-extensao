import { Learn } from './learn';
import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, forkJoin, of } from 'rxjs';

import type { MobileNet } from '@tensorflow-models/mobilenet';


import {
  AccountingDispatch,
  ApiService,
  CertificateSettings,
  CreateInvoiceRequest,
  Invoice,
  InvoiceItem,
  InvoiceStatus,
  Product,
  ServiceHealth,
} from './api.service';

interface ApiErrorPayload {
  error?: string;
  code?: string;
  phrase?: string;
  service?: string;
  location?: string;
  file?: string;
  path?: string;
  hint?: string;
  upstreamCode?: string;
  upstreamService?: string;
  upstreamLocation?: string;
  upstreamFile?: string;
  upstreamPath?: string;
}

interface CatalogSuggestion {
  keywords: string[];
  description: string;
  ncm: string;
  taxProfile: string;
  taxRate: number;
  cfop: string;
  csosn: string;
  productType: string;
  origin: string;
}

interface CatalogMatch {
  suggestion: CatalogSuggestion;
  score: number;
  matchedKeywords: string[];
}

interface PackageTypography {
  title: string;
  detail: string;
  rawText: string;
  score: number;
}

interface OcrSource {
  label: string;
  canvas: HTMLCanvasElement;
}

interface NcmRawEntry {
  Codigo: string;
  Descricao: string;
}

interface NcmDatabase {
  Data_Ultima_Atualizacao_NCM: string;
  Ato: string;
  Nomenclaturas: NcmRawEntry[];
}

interface NcmEntry {
  code: string;
  description: string;
  searchText: string;
  tokens: string[];
}

interface NcmCandidate {
  entry: NcmEntry;
  score: number;
  matchedTokens: string[];
}

type PricingChannelType = 'physical' | 'online';

interface PricingChannel {
  id: string;
  name: string;
  type: PricingChannelType;
  paymentFeePercent: number;
  paymentFeeFixed: number;
  marketplaceFeePercent: number;
  fixedCostPercent: number;
  trafficCost: number;
  packagingCost: number;
  targetMarginPercent: number;
}

interface PricingResult {
  productCost: number;
  salePrice: number;
  taxValue: number;
  paymentFee: number;
  marketplaceFee: number;
  fixedCost: number;
  channelCost: number;
  totalCost: number;
  netProfit: number;
  loss: number;
  netMargin: number;
  markup: number;
  breakEvenPrice: number;
  suggestedPrice: number;
  suggestedPriceValid: boolean;
  status: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
  advice: string;
}

interface SystemFault {
  code: string;
  phrase: string;
  service: string;
  location: string;
  file: string;
  path: string;
  hint: string;
  recoverable: boolean;
}

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, Learn],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  readonly statuses: Array<'Todos' | InvoiceStatus> = [
    'Todos',
    'Aberta',
    'Autorizada',
    'Contingencia',
    'EnviadaContabilidade',
    'Cancelada',
    'Inutilizada',
  ];
  readonly paymentMethods = ['Pix', 'Boleto', 'Cartao', 'Dinheiro', 'Transferencia'];
  readonly paymentStatuses = ['Pendente', 'Pago', 'Parcial', 'Vencido'];
  readonly taxRegimes = ['Simples Nacional', 'Lucro Presumido', 'Lucro Real', 'MEI'];
  readonly simpleCsosnOptions = ['101', '102', '103', '201', '202', '203', '300', '400', '500', '900'];
  readonly cstOptions = ['00', '10', '20', '30', '40', '41', '50', '51', '60', '70', '90'];
  readonly states = [
    'AC',
    'AL',
    'AP',
    'AM',
    'BA',
    'CE',
    'DF',
    'ES',
    'GO',
    'MA',
    'MT',
    'MS',
    'MG',
    'PA',
    'PB',
    'PR',
    'PE',
    'PI',
    'RJ',
    'RN',
    'RS',
    'RO',
    'RR',
    'SC',
    'SP',
    'SE',
    'TO',
  ];
  readonly months = [
    { value: 0, label: 'Todos' },
    { value: 1, label: 'Janeiro' },
    { value: 2, label: 'Fevereiro' },
    { value: 3, label: 'Marco' },
    { value: 4, label: 'Abril' },
    { value: 5, label: 'Maio' },
    { value: 6, label: 'Junho' },
    { value: 7, label: 'Julho' },
    { value: 8, label: 'Agosto' },
    { value: 9, label: 'Setembro' },
    { value: 10, label: 'Outubro' },
    { value: 11, label: 'Novembro' },
    { value: 12, label: 'Dezembro' },
  ];
  readonly years = Array.from({ length: 7 }, (_, index) => new Date().getFullYear() - index);

  products: Product[] = [];
  invoices: Invoice[] = [];
  ledgerInvoices: Invoice[] = [];
  invoiceItems: InvoiceItem[] = [];
  activeTab: 'learn' | 'products' | 'invoices' | 'accounting' | 'pricing' = 'learn';
  loading = false;
  savingProduct = false;
  savingInvoice = false;
  processingInvoiceId: number | null = null;
  stockFailure = false;
  diagnosingFailure = false;
  healingFailure = false;
  systemFault: SystemFault | null = null;
  selectedInvoice: Invoice | null = null;
  productModalOpen = false;
  editingProduct = false;
  photoPreviewUrl = '';
  photoSuggestion = '';
  productLookupText = '';
  productLookupMatches: CatalogMatch[] = [];
  ncmLookupCandidates: NcmCandidate[] = [];
  ncmSource = '';
  accountingResult: AccountingDispatch | null = null;
  readingPhoto = false;
  certificateForm: CertificateSettings = {
    companyName: '',
    companyDocument: '',
    companyState: 'CE',
    taxRegime: 'Simples Nacional',
    certificateYear: new Date().getFullYear(),
    certificateFileName: '',
    password: '',
    passwordConfigured: false,
    updatedAt: '',
  };
  accountingPeriod = {
    email: 'contabilidade@empresa.local',
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
  };
  pricingChannels: PricingChannel[] = this.loadPricingChannels();
  selectedPricingChannelId = this.pricingChannels[0]?.id ?? '';
  pricingProductCode = '';
  pricingForm = {
    productCost: 0,
    supplierFreight: 0,
    salePrice: 0,
    taxRatePercent: 0,
  };

  currentYear = new Date().getFullYear();
  filterYear = this.currentYear;
  filterMonth = new Date().getMonth() + 1;
  filterStatus: 'Todos' | InvoiceStatus = 'Todos';

  productForm: Product = this.emptyProduct();
  itemForm = {
    productCode: '',
    quantity: 1,
    unitValue: 0,
  };
  invoiceForm: Omit<CreateInvoiceRequest, 'items'> = {
    customerName: 'Consumidor final',
    customerDocument: '',
    customerEmail: '',
    customerState: 'CE',
    accountingEmail: 'contabilidade@empresa.local',
    paymentMethod: 'Pix',
    paymentStatus: 'Pendente',
    amountPaid: 0,
    dueDate: '',
  };
  cancelReason = 'Cancelamento administrativo';
  alert: { type: 'success' | 'error' | 'info'; text: string } | null = null;

  private readonly catalog: CatalogSuggestion[] = [
    {
      keywords: ['camisa', 'camiseta', 'roupa', 'uniforme'],
      description: 'Camiseta personalizada',
      ncm: '6109.10.00',
      taxProfile: 'Confeccao - aliquota interna estimada',
      taxRate: 12,
      cfop: '5102',
      csosn: '102',
      productType: 'Vestuario',
      origin: 'Nacional',
    },
    {
      keywords: ['tecido', 'malha', 'algodao'],
      description: 'Tecido de algodao',
      ncm: '5208.52.00',
      taxProfile: 'Textil - faixa padrao',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Materia-prima textil',
      origin: 'Nacional',
    },
    {
      keywords: ['mouse', 'teclado', 'computador', 'notebook'],
      description: 'Periferico de informatica',
      ncm: '8471.60.52',
      taxProfile: 'Informatica - faixa padrao',
      taxRate: 15,
      cfop: '5102',
      csosn: '102',
      productType: 'Informatica',
      origin: 'Nacional',
    },
    {
      keywords: ['celular', 'telefone', 'smartphone'],
      description: 'Aparelho celular',
      ncm: '8517.13.00',
      taxProfile: 'Eletronico - faixa padrao',
      taxRate: 20,
      cfop: '5102',
      csosn: '102',
      productType: 'Eletronico',
      origin: 'Importado',
    },
    {
      keywords: ['antena', 'antenna', 'aerial', 'uhf', 'vhf', 'yagi', 'receptor', 'recepcao', 'sinal', 'tv'],
      description: 'Antena para recepcao de sinal',
      ncm: '8529.10.90',
      taxProfile: 'Outras antenas e refletores de antena',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Eletronico / antena',
      origin: 'Nacional',
    },
    {
      keywords: ['sapato', 'tenis', 'calcado'],
      description: 'Calcado',
      ncm: '6404.11.00',
      taxProfile: 'Calcados - faixa padrao',
      taxRate: 12,
      cfop: '5102',
      csosn: '102',
      productType: 'Calcado',
      origin: 'Nacional',
    },
    {
      keywords: ['capacete', 'helmet', 'moto', 'motocicleta', 'motorcycle', 'asx'],
      description: 'Capacete de motociclista',
      ncm: '6506.10.00',
      taxProfile: 'Equipamento de protecao - capacete',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'EPI / acessorio de motocicleta',
      origin: 'Nacional',
    },
    {
      keywords: ['broca', 'drill', 'furadeira', 'furo', 'metal duro', 'helicoidal'],
      description: 'Broca para furadeira',
      ncm: '8207.50.11',
      taxProfile: 'Ferramentas intercambiaveis - brocas',
      taxRate: 12,
      cfop: '5102',
      csosn: '102',
      productType: 'Ferramenta',
      origin: 'Nacional',
    },
    {
      keywords: ['parafuso', 'porca', 'arruela', 'fixador'],
      description: 'Fixador metalico',
      ncm: '7318.15.00',
      taxProfile: 'Fixadores metalicos',
      taxRate: 12,
      cfop: '5102',
      csosn: '102',
      productType: 'Ferragem',
      origin: 'Nacional',
    },
    {
      keywords: ['garrafa', 'copo', 'squeeze', 'termica'],
      description: 'Garrafa termica',
      ncm: '9617.00.10',
      taxProfile: 'Recipientes termicos',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Utilidade domestica',
      origin: 'Nacional',
    },
    {
      keywords: ['caneta', 'lapis', 'marcador', 'esferografica'],
      description: 'Material de escrita',
      ncm: '9608.10.00',
      taxProfile: 'Papelaria - escrita',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Papelaria',
      origin: 'Nacional',
    },
    {
      keywords: ['caderno', 'cadernos', 'notebook escolar', 'notebook paper'],
      description: 'Caderno',
      ncm: '4820.20.00',
      taxProfile: 'Cadernos escolares e de anotacao',
      taxRate: 12,
      cfop: '5102',
      csosn: '102',
      productType: 'Papelaria',
      origin: 'Nacional',
    },
    {
      keywords: ['agenda', 'bloco', 'bloco de notas', 'livro registro', 'recibo', 'papel carta'],
      description: 'Agenda ou bloco de notas',
      ncm: '4820.10.00',
      taxProfile: 'Agendas, blocos de notas e livros de registro',
      taxRate: 12,
      cfop: '5102',
      csosn: '102',
      productType: 'Papelaria',
      origin: 'Nacional',
    },
    {
      keywords: ['livro', 'livros', 'apostila', 'revista', 'manual impresso'],
      description: 'Livro ou publicacao impressa',
      ncm: '4901.99.00',
      taxProfile: 'Livros, brochuras e impressos semelhantes',
      taxRate: 0,
      cfop: '5102',
      csosn: '102',
      productType: 'Livro / impresso',
      origin: 'Nacional',
    },
    {
      keywords: ['wheelbarrow', 'barrow', 'cart', 'handcart', 'carrinho', 'carrinho de mao', 'carriola'],
      description: 'Carrinho de mao',
      ncm: '8716.80.00',
      taxProfile: 'Veiculos sem propulsao mecanica - carrinho de mao',
      taxRate: 12,
      cfop: '5102',
      csosn: '102',
      productType: 'Ferramenta / transporte manual',
      origin: 'Nacional',
    },
    {
      keywords: ['televisao', 'television', 'tv', 'monitor', 'screen', 'display'],
      description: 'Monitor ou televisao',
      ncm: '8528.52.00',
      taxProfile: 'Aparelho receptor/monitor - faixa padrao',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Eletronico',
      origin: 'Importado',
    },
    {
      keywords: ['camera', 'webcam', 'digital camera', 'filmadora'],
      description: 'Camera digital',
      ncm: '8525.89.29',
      taxProfile: 'Camera e equipamento de captura de imagem',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Eletronico',
      origin: 'Importado',
    },
    {
      keywords: ['fone', 'headphone', 'headset', 'earphone', 'microfone'],
      description: 'Fone de ouvido',
      ncm: '8518.30.00',
      taxProfile: 'Fones e microfones',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Eletronico / audio',
      origin: 'Importado',
    },
    {
      keywords: ['relogio', 'watch', 'smartwatch', 'clock'],
      description: 'Relogio',
      ncm: '9102.11.10',
      taxProfile: 'Relogios de pulso - faixa padrao',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Acessorio',
      origin: 'Importado',
    },
    {
      keywords: ['mochila', 'bolsa', 'backpack', 'bag', 'purse'],
      description: 'Mochila ou bolsa',
      ncm: '4202.92.00',
      taxProfile: 'Bolsas e artefatos semelhantes',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Acessorio',
      origin: 'Nacional',
    },
    {
      keywords: ['oculos', 'sunglasses', 'eyeglasses', 'lente'],
      description: 'Oculos',
      ncm: '9004.10.00',
      taxProfile: 'Oculos e lentes - faixa padrao',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Acessorio',
      origin: 'Importado',
    },
    {
      keywords: ['cadeira', 'chair', 'poltrona', 'assento', 'seat'],
      description: 'Cadeira',
      ncm: '9401.79.00',
      taxProfile: 'Moveis para assento',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Movel',
      origin: 'Nacional',
    },
    {
      keywords: ['mesa', 'table', 'desk', 'escrivaninha'],
      description: 'Mesa',
      ncm: '9403.60.00',
      taxProfile: 'Moveis de madeira/outros materiais',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Movel',
      origin: 'Nacional',
    },
    {
      keywords: ['oleo', 'lubrificante', 'lubrax', '15w40', '15w 40', '15w-40', 'sae', 'motor oil', 'lubricant'],
      description: 'Oleo lubrificante automotivo',
      ncm: '2710.19.32',
      taxProfile: 'Oleos lubrificantes com aditivos',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Lubrificante automotivo',
      origin: 'Nacional',
    },
    {
      keywords: ['lampada', 'luminaria', 'lamp', 'bulb', 'led lamp'],
      description: 'Lampada ou luminaria',
      ncm: '8539.52.00',
      taxProfile: 'Lampadas LED e iluminacao',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Eletrico',
      origin: 'Importado',
    },
    {
      keywords: ['ventilador', 'fan', 'cooler'],
      description: 'Ventilador',
      ncm: '8414.51.90',
      taxProfile: 'Ventiladores - faixa padrao',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Eletrodomestico',
      origin: 'Importado',
    },
    {
      keywords: ['geladeira', 'refrigerador', 'refrigerator', 'freezer'],
      description: 'Refrigerador',
      ncm: '8418.10.00',
      taxProfile: 'Refrigeradores e congeladores',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Eletrodomestico',
      origin: 'Importado',
    },
    {
      keywords: ['microondas', 'microwave', 'forno microondas'],
      description: 'Forno microondas',
      ncm: '8516.50.00',
      taxProfile: 'Forno microondas',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Eletrodomestico',
      origin: 'Importado',
    },
    {
      keywords: ['bicicleta', 'bicycle', 'bike'],
      description: 'Bicicleta',
      ncm: '8712.00.10',
      taxProfile: 'Bicicletas',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Veiculo sem motor',
      origin: 'Nacional',
    },
    {
      keywords: ['bola', 'ball', 'futebol', 'soccer', 'basketball'],
      description: 'Bola esportiva',
      ncm: '9506.62.00',
      taxProfile: 'Artigos esportivos - bolas',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Esporte',
      origin: 'Nacional',
    },
    {
      keywords: ['copo', 'mug', 'cup', 'caneca', 'taca'],
      description: 'Copo ou caneca',
      ncm: '3924.10.00',
      taxProfile: 'Utilidades domesticas de plastico/mesa',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Utilidade domestica',
      origin: 'Nacional',
    },
    {
      keywords: ['prato', 'plate', 'travessa'],
      description: 'Prato',
      ncm: '6912.00.00',
      taxProfile: 'Artigos de mesa e cozinha',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Utilidade domestica',
      origin: 'Nacional',
    },
    {
      keywords: ['faca', 'garfo', 'colher', 'knife', 'fork', 'spoon', 'talher'],
      description: 'Talher',
      ncm: '8215.99.10',
      taxProfile: 'Talheres de mesa',
      taxRate: 18,
      cfop: '5102',
      csosn: '102',
      productType: 'Utilidade domestica',
      origin: 'Nacional',
    },
    {
      keywords: ['martelo', 'hammer'],
      description: 'Martelo',
      ncm: '8205.20.00',
      taxProfile: 'Ferramentas manuais - martelos',
      taxRate: 12,
      cfop: '5102',
      csosn: '102',
      productType: 'Ferramenta',
      origin: 'Nacional',
    },
    {
      keywords: ['chave de fenda', 'screwdriver', 'chave philips'],
      description: 'Chave de fenda',
      ncm: '8205.40.00',
      taxProfile: 'Ferramentas manuais - chaves',
      taxRate: 12,
      cfop: '5102',
      csosn: '102',
      productType: 'Ferramenta',
      origin: 'Nacional',
    },
    {
      keywords: ['alicate', 'pliers'],
      description: 'Alicate',
      ncm: '8203.20.10',
      taxProfile: 'Ferramentas manuais - alicates',
      taxRate: 12,
      cfop: '5102',
      csosn: '102',
      productType: 'Ferramenta',
      origin: 'Nacional',
    },
    {
      keywords: ['pa', 'pas', 'pá', 'pás', 'shovel', 'spade'],
      description: 'Pa manual',
      ncm: '8201.10.00',
      taxProfile: 'Pas de metais comuns para agricultura, horticultura ou silvicultura',
      taxRate: 12,
      cfop: '5102',
      csosn: '102',
      productType: 'Ferramenta manual',
      origin: 'Nacional',
    },
  ];
  private readonly ncmSearchAliases: Record<string, string[]> = {
    agenda: ['4820.10.00', 'livros de registro blocos de notas agendas papelaria'],
    apostila: ['4901.99.00', 'livros brochuras impressos semelhantes'],
    bateria: ['pilhas acumuladores eletricos'],
    bloco: ['4820.10.00', 'blocos de notas apontamentos papelaria'],
    borracha: ['4016.92.00', 'borrachas de apagar papelaria'],
    brinquedo: ['9503.00.99', 'brinquedos modelos reduzidos jogos infantis'],
    cabo: ['8544', 'cabos condutores eletricos isolados conectores'],
    caderno: ['4820.20.00', 'cadernos papelaria escolar'],
    carregador: ['8504.40', 'conversores eletricos carregadores fontes alimentacao'],
    celular: ['8517.13.00', 'smartphones telefones para redes celulares'],
    chinelo: ['6402', 'calcados com sola exterior borracha plastico'],
    creme: ['3304', 'preparacoes beleza pele cosmeticos'],
    desodorante: ['3307.20', 'desodorantes corporais antiperspirantes'],
    escova: ['9603', 'escovas pinceis vassouras'],
    fone: ['8518.30.00', 'fones de ouvido auscultadores microfones'],
    garrafa: ['9617.00.10', 'garrafas termicas recipientes isotermicos'],
    impressora: ['8443.32', 'maquinas impressao impressoras'],
    livro: ['4901.99.00', 'livros brochuras impressos semelhantes'],
    mochila: ['4202.92.00', 'bolsas mochilas artefatos semelhantes'],
    mouse: ['8471.60', 'unidades entrada mouse teclado informatica'],
    perfume: ['3303.00', 'perfumes aguas de colonia'],
    pilha: ['8506', 'pilhas baterias primarias'],
    roupa: ['vestuario camisetas calcas malhas algodao'],
    sabonete: ['3401.11', 'sabonetes produtos preparacoes para lavagem pele'],
    shampoo: ['3305.10', 'xampus preparacoes capilares'],
    tenis: ['6404', 'calcados tenis sola borracha plastico'],
    teclado: ['8471.60', 'teclados unidades entrada processamento dados'],
  };
  private visionModel?: MobileNet;
  private ncmEntries: NcmEntry[] = [];
  private ncmLoad?: Promise<void>;

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.ensureNcmDatabase();
    this.loadData();
    this.checkSystemFaults(false);
  }

  loadData(): void {
    this.loading = true;
    forkJoin({
      products: this.api.getProducts(),
      invoices: this.api.getInvoices(this.invoiceFilters()),
      ledgerInvoices: this.api.getInvoices({}),
      certificate: this.api.getCertificateSettings(),
    }).subscribe({
      next: ({ products, invoices, ledgerInvoices, certificate }) => {
        this.products = products;
        this.invoices = invoices;
        this.ledgerInvoices = ledgerInvoices;
        this.certificateForm = this.normalizedCertificate({ ...certificate, password: '' });
        if (!this.invoiceForm.customerState) {
          this.invoiceForm.customerState = this.certificateForm.companyState;
        }
        this.applyFiscalContextToProduct();
        this.loading = false;
        if (!this.itemForm.productCode && products.length > 0) {
          this.itemForm.productCode = products[0].code;
          this.syncItemFromProduct();
        }
        if (!this.pricingProductCode && products.length > 0) {
          this.pricingProductCode = products[0].code;
          this.syncPricingFromProduct();
        }
        this.refreshSelectedInvoice(invoices);
      },
      error: (error) => {
        this.loading = false;
        this.showError(error, 'Nao foi possivel carregar os dados. Verifique se os dois microsservicos estao rodando.');
      },
    });
  }

  openNewProduct(): void {
    this.editingProduct = false;
    this.productForm = this.emptyProduct();
    this.photoPreviewUrl = '';
    this.photoSuggestion = '';
    this.productLookupText = '';
    this.productLookupMatches = [];
    this.ncmLookupCandidates = [];
    this.productModalOpen = true;
  }

  editProduct(product: Product): void {
    this.editingProduct = true;
    this.productForm = { ...product };
    this.photoPreviewUrl = product.photoDataUrl || '';
    this.photoSuggestion = '';
    this.productLookupText = product.description;
    this.onProductLookupChange();
    void this.onProductNameChange();
    this.productModalOpen = true;
  }

  closeProductModal(): void {
    this.productModalOpen = false;
    this.photoPreviewUrl = '';
    this.photoSuggestion = '';
    this.productLookupText = '';
    this.productLookupMatches = [];
    this.ncmLookupCandidates = [];
  }

  saveProduct(): void {
    this.productForm = this.normalizedProduct(this.productForm);
    const validationError = this.productValidationError();
    if (validationError) {
      this.showAlert('error', validationError);
      return;
    }

    this.savingProduct = true;
    const request = this.editingProduct
      ? this.api.updateProduct(this.productForm)
      : this.api.saveProduct(this.productForm);

    request.subscribe({
      next: () => {
        this.savingProduct = false;
        this.closeProductModal();
        this.showAlert('success', this.editingProduct ? 'Produto atualizado.' : 'Produto cadastrado.');
        this.loadData();
      },
      error: (error) => {
        this.savingProduct = false;
        this.showError(error, 'Erro ao salvar produto.');
      },
    });
  }

  deleteProduct(product: Product): void {
    const confirmed = confirm(`Excluir o produto ${product.code} - ${product.description}?`);
    if (!confirmed) {
      return;
    }
    this.api.deleteProduct(product.code).subscribe({
      next: () => {
        this.showAlert('success', 'Produto excluido.');
        this.loadData();
      },
      error: (error) => this.showError(error, 'Erro ao excluir produto.'),
    });
  }

  adjustProductStock(product: Product): void {
    const value = prompt(`Nova quantidade para ${product.description}:`, String(product.balance));
    if (value === null) {
      return;
    }
    const balance = Number(value);
    if (Number.isNaN(balance) || balance < 0) {
      this.showAlert('error', 'Quantidade invalida.');
      return;
    }
    this.api.adjustStock(product.code, balance, 'Ajuste manual pelo gerenciador').subscribe({
      next: () => {
        this.showAlert('success', 'Estoque ajustado.');
        this.loadData();
      },
      error: (error) => this.showError(error, 'Erro ao ajustar estoque.'),
    });
  }

  onPhotoDrop(event: DragEvent): void {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      this.applyPhotoSuggestion(file);
    }
  }

  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.applyPhotoSuggestion(file);
    }
  }

  allowDrop(event: DragEvent): void {
    event.preventDefault();
  }

  clearProductPhoto(): void {
    this.productForm.photoDataUrl = '';
    this.photoPreviewUrl = '';
    this.photoSuggestion = 'Foto removida do cadastro local.';
  }

  fillProductFromLookup(): void {
    const match = this.rankCatalogSuggestions(this.productLookupText)[0];
    if (!match) {
      this.showAlert(
        'error',
        'Produto nao encontrado no catalogo local. Informe nome/NCM manualmente ou adicione uma palavra mais especifica.',
      );
      return;
    }
    this.applyProductLookupMatch(match);
  }

  onProductLookupChange(): void {
    this.productLookupMatches = this.rankCatalogSuggestions(this.productLookupText).slice(0, 5);
    const firstMatch = this.productLookupMatches[0];
    if (firstMatch && firstMatch.score >= 10) {
      this.applyCatalogSuggestion(firstMatch.suggestion);
    }
  }

  async onProductNameChange(): Promise<void> {
    const text = `${this.productForm.description} ${this.productForm.packagingDescription}`;
    this.productLookupText = text.trim() || this.productLookupText;
    this.productLookupMatches = this.rankCatalogSuggestions(text).slice(0, 5);
    this.ncmLookupCandidates = this.quickNcmCandidatesFromCatalog(text);

    const quickMatch = this.ncmLookupCandidates[0];
    if (quickMatch && quickMatch.score >= 7) {
      this.applyFiscalSuggestionOnly(this.suggestionFromOfficialNcm(quickMatch));
    }

    await this.ensureNcmDatabase();
    this.ncmLookupCandidates = this.mergeNcmCandidates([
      ...this.ncmLookupCandidates,
      ...this.findOfficialNcmCandidates(text, 5, 6),
    ]).slice(0, 5);

    const catalogMatch = this.productLookupMatches[0];
    if (catalogMatch && catalogMatch.score >= 7) {
      this.applyFiscalSuggestionOnly(catalogMatch.suggestion);
      return;
    }

    const officialMatch = this.ncmLookupCandidates[0];
    if (officialMatch && officialMatch.score >= 24) {
      this.applyFiscalSuggestionOnly(this.suggestionFromOfficialNcm(officialMatch));
    }
  }

  applyNcmCandidate(candidate: NcmCandidate): void {
    const suggestion = this.suggestionFromOfficialNcm(candidate);
    this.productForm.description = suggestion.description;
    this.productForm.packagingDescription = candidate.entry.description;
    this.applyFiscalSuggestionOnly(suggestion);
    this.photoSuggestion = `NCM preenchido pelo nome digitado: ${candidate.entry.code} - ${candidate.entry.description}. Termos: ${candidate.matchedTokens.join(', ')}.`;
  }

  canSaveProduct(): boolean {
    return !this.productValidationError();
  }

  applyProductLookupMatch(match: CatalogMatch): void {
    this.applyCatalogSuggestion(match.suggestion);
    this.productLookupText = match.suggestion.description;
    this.productLookupMatches = this.rankCatalogSuggestions(this.productLookupText).slice(0, 5);
    this.photoSuggestion = `Preenchido pelo catalogo local: ${match.suggestion.description}, NCM ${match.suggestion.ncm}, CFOP ${match.suggestion.cfop}, CSOSN ${match.suggestion.csosn}, aliquota ${match.suggestion.taxRate}%. Palavra(s): ${match.matchedKeywords.join(', ')}.`;
  }

  fiscalCodeOptions(): string[] {
    return this.isSimpleRegime() ? this.simpleCsosnOptions : this.cstOptions;
  }

  isSimpleRegime(): boolean {
    return this.certificateForm.taxRegime === 'Simples Nacional' || this.certificateForm.taxRegime === 'MEI';
  }

  onTaxRegimeChange(): void {
    this.applyFiscalContextToProduct();
  }

  onStateChange(): void {
    this.applyFiscalContextToProduct();
  }

  detectStateFromCurrentText(): void {
    const detected = this.detectStateFromText(
      `${this.productForm.description} ${this.productForm.packagingDescription} ${this.productLookupText} ${this.invoiceForm.customerName}`,
    );
    if (!detected) {
      this.showAlert('info', 'Nao encontrei UF no texto atual. Selecione manualmente.');
      return;
    }
    this.invoiceForm.customerState = detected;
    this.applyFiscalContextToProduct();
    this.showAlert('success', `UF detectada: ${detected}. CFOP ajustado pelo estado.`);
  }

  syncItemFromProduct(): void {
    const product = this.selectedProduct();
    if (!product) {
      return;
    }
    this.itemForm.unitValue = product.salePrice;
  }

  addInvoiceItem(): void {
    const product = this.selectedProduct();
    if (!product || this.itemForm.quantity <= 0) {
      this.showAlert('error', 'Escolha um produto e uma quantidade positiva.');
      return;
    }
    if (product.balance < this.itemForm.quantity) {
      this.showAlert('error', `Quantidade insuficiente. Disponivel: ${product.balance}.`);
      return;
    }

    const quantity = Number(this.itemForm.quantity);
    const unitValue = this.parseMoney(this.itemForm.unitValue || product.salePrice || 0);
    const item: InvoiceItem = {
      productCode: product.code,
      description: product.description,
      ncm: product.ncm,
      quantity,
      unitValue,
      purchaseValue: product.purchasePrice,
      taxRate: product.taxRate,
      taxValue: this.round2(unitValue * quantity * product.taxRate / 100),
      totalValue: this.round2(unitValue * quantity),
    };

    const existing = this.invoiceItems.find((draft) => draft.productCode === product.code);
    if (existing) {
      existing.quantity += quantity;
      existing.taxValue = this.round2(existing.unitValue * existing.quantity * existing.taxRate / 100);
      existing.totalValue = this.round2(existing.unitValue * existing.quantity);
    } else {
      this.invoiceItems.push(item);
    }
    this.itemForm.quantity = 1;
    this.showAlert('info', 'Produto incluido na NF em aberto.');
  }

  removeInvoiceItem(productCode: string): void {
    this.invoiceItems = this.invoiceItems.filter((item) => item.productCode !== productCode);
  }

  createInvoice(): void {
    if (this.invoiceItems.length === 0) {
      this.showAlert('error', 'Inclua ao menos um produto antes de criar a NF.');
      return;
    }

    this.savingInvoice = true;
    this.invoiceForm.amountPaid = this.parseMoney(this.invoiceForm.amountPaid);
    if (!this.invoiceForm.paymentMethod || this.invoiceForm.amountPaid === null || this.invoiceForm.amountPaid === undefined) {
      this.savingInvoice = false;
      this.showAlert('error', 'Forma de pagamento e valor recebido sao obrigatorios.');
      return;
    }
    this.api.createInvoice({ ...this.invoiceForm, items: this.invoiceItems }).subscribe({
      next: (invoice) => {
        this.savingInvoice = false;
        this.invoiceItems = [];
        this.selectedInvoice = invoice;
        this.activeTab = 'invoices';
        this.showAlert('success', `NF ${invoice.number} criada com status Aberta.`);
        this.loadData();
      },
      error: (error) => {
        this.savingInvoice = false;
        this.showError(error, 'Erro ao criar NF.');
      },
    });
  }

  issueInvoice(invoice: Invoice): void {
    if (invoice.status !== 'Aberta') {
      this.showAlert('error', 'Somente notas com status Aberta podem ser emitidas.');
      return;
    }
    this.processingInvoiceId = invoice.id;
    this.api.issueInvoice(invoice.id, this.newIdempotencyKey(invoice.id)).subscribe({
      next: (updated) => {
        this.processingInvoiceId = null;
        this.selectedInvoice = updated;
        this.showAlert('success', `NF ${invoice.number} autorizada. Estoque atualizado e XML gerado.`);
        this.loadData();
      },
      error: (error) => {
        this.processingInvoiceId = null;
        this.showError(error, 'Erro ao emitir NF. A nota permanece Aberta.');
        this.loadData();
      },
    });
  }

  sendAccounting(invoice: Invoice): void {
    const email = invoice.accountingEmail || this.invoiceForm.accountingEmail;
    if (!email) {
      this.showAlert('error', 'Informe o email da contabilidade.');
      return;
    }
    this.processingInvoiceId = invoice.id;
    this.api.sendAccounting(invoice.id, email).subscribe({
      next: (result) => {
        this.processingInvoiceId = null;
        this.accountingResult = result;
        this.selectedInvoice = result.invoice ?? this.selectedInvoice;
        this.activeTab = 'accounting';
        this.showAlert('success', result.message);
        this.loadData();
      },
      error: (error) => {
        this.processingInvoiceId = null;
        this.showError(error, 'Erro ao gerar remessa contabil.');
      },
    });
  }

  sendAccountingByPeriod(): void {
    if (!this.accountingPeriod.email || !this.accountingPeriod.year) {
      this.showAlert('error', 'Informe email da contabilidade e ano da remessa.');
      return;
    }
    this.api
      .sendAccountingPeriod(this.accountingPeriod.email, this.accountingPeriod.year, Number(this.accountingPeriod.month || 0))
      .subscribe({
        next: (result) => {
          this.accountingResult = result;
          this.showAlert('success', result.message);
          this.loadData();
        },
        error: (error) => this.showError(error, 'Erro ao gerar remessa contabil por periodo.'),
      });
  }

  saveCertificate(): void {
    this.certificateForm = this.normalizedCertificate(this.certificateForm);
    this.api.saveCertificateSettings(this.certificateForm).subscribe({
      next: (settings) => {
        this.certificateForm = this.normalizedCertificate({ ...settings, password: '' });
        this.applyFiscalContextToProduct();
        this.showAlert('success', 'Certificado, UF e regime fiscal cadastrados localmente.');
      },
      error: (error) => this.showError(error, 'Erro ao salvar certificado.'),
    });
  }

  onCertificateSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.certificateForm.certificateFileName = file.name;
    }
  }

  cancelInvoice(invoice: Invoice): void {
    this.api.cancelInvoice(invoice.id, this.cancelReason).subscribe({
      next: (updated) => {
        this.selectedInvoice = updated;
        this.showAlert('success', `NF ${invoice.number} cancelada.`);
        this.loadData();
      },
      error: (error) => this.showError(error, 'Erro ao cancelar NF.'),
    });
  }

  markContingency(invoice: Invoice): void {
    this.api.markContingency(invoice.id, 'Contingencia acionada pelo gerenciador local').subscribe({
      next: (updated) => {
        this.selectedInvoice = updated;
        this.showAlert('success', `NF ${invoice.number} marcada em contingencia.`);
        this.loadData();
      },
      error: (error) => this.showError(error, 'Erro ao marcar contingencia.'),
    });
  }

  voidInvoice(invoice: Invoice): void {
    this.api.voidInvoice(invoice.id, 'Inutilizacao de numeracao pelo gerenciador local').subscribe({
      next: (updated) => {
        this.selectedInvoice = updated;
        this.showAlert('success', `NF ${invoice.number} inutilizada.`);
        this.loadData();
      },
      error: (error) => this.showError(error, 'Erro ao inutilizar NF.'),
    });
  }

  viewInvoice(invoice: Invoice): void {
    this.selectedInvoice = invoice;
  }

  closeInvoicePreview(): void {
    this.selectedInvoice = null;
  }

  downloadXml(invoice: Invoice): void {
    const emitDownload = (xml: string) => this.downloadText(`NF-${invoice.number}.xml`, xml, 'application/xml');
    if (invoice.xmlContent) {
      emitDownload(invoice.xmlContent);
      return;
    }
    this.api.getInvoiceXml(invoice.id).subscribe({
      next: (result) => emitDownload(result.xml),
      error: (error) => this.showError(error, 'Erro ao obter XML.'),
    });
  }

  downloadEmailDraft(): void {
    if (!this.accountingResult) {
      return;
    }
    const suffix = this.accountingResult.invoice
      ? `NF-${this.accountingResult.invoice.number}`
      : `remessa-${this.accountingResult.periodYear}-${this.accountingResult.periodMonth || 'ano'}`;
    this.downloadText(
      `${suffix}-contabilidade.eml`,
      this.accountingResult.emailDraft,
      'message/rfc822',
    );
  }

  downloadAccountingXml(): void {
    if (!this.accountingResult) {
      return;
    }
    const suffix = this.accountingResult.invoice
      ? `NF-${this.accountingResult.invoice.number}`
      : `remessa-${this.accountingResult.periodYear}-${this.accountingResult.periodMonth || 'ano'}`;
    this.downloadText(`${suffix}.xml`, this.accountingResult.xml, 'application/xml');
  }

  setFailure(enabled: boolean): void {
    this.api.setStockFailure(enabled).subscribe({
      next: () => {
        this.stockFailure = enabled;
        this.showAlert(enabled ? 'info' : 'success', enabled ? 'Falha do estoque ativada.' : 'Estoque restaurado.');
      },
      error: (error) => this.showError(error, 'Nao foi possivel alterar a falha simulada.'),
    });
  }

  checkSystemFaults(showSuccess = true): void {
    this.diagnosingFailure = true;
    forkJoin({
      estoque: this.api.getStockHealth().pipe(catchError((error) => of(this.healthFailure('estoque-service', error)))),
      faturamento: this.api.getBillingHealth().pipe(catchError((error) => of(this.healthFailure('faturamento-service', error)))),
    }).subscribe({
      next: ({ estoque, faturamento }) => {
        this.diagnosingFailure = false;
        const fault = this.faultFromHealth(estoque) ?? this.faultFromHealth(faturamento);
        this.systemFault = fault;
        this.stockFailure = Boolean(estoque.failureMode || estoque.status !== 'ok');
        if (fault) {
          this.showAlert('error', this.formatSystemFault(fault));
          return;
        }
        if (showSuccess) {
          this.showAlert('success', 'Diagnostico concluido: estoque e faturamento respondendo normalmente.');
        }
      },
      error: (error) => {
        this.diagnosingFailure = false;
        this.showError(error, 'Nao foi possivel verificar os microsservicos.');
      },
    });
  }

  fixSystemFault(): void {
    if (!this.systemFault) {
      this.checkSystemFaults();
      return;
    }
    if (!this.systemFault.recoverable) {
      this.showAlert('error', this.formatSystemFault(this.systemFault));
      return;
    }
    this.healingFailure = true;
    this.api.setStockFailure(false).subscribe({
      next: () => {
        this.healingFailure = false;
        this.stockFailure = false;
        this.systemFault = null;
        this.showAlert('success', 'Falha recuperavel corrigida. O estoque saiu do modo degradado e os dados foram recarregados.');
        this.loadData();
        this.checkSystemFaults(false);
      },
      error: (error) => {
        this.healingFailure = false;
        this.showError(error, 'Nao foi possivel corrigir automaticamente.');
      },
    });
  }

  private healthFailure(service: string, error: unknown): ServiceHealth {
    return {
      status: 'offline',
      service,
      failureMode: false,
      code: service === 'estoque-service' ? 'NF-EST-000' : 'NF-FAT-000',
      location: service === 'estoque-service' ? 'GET http://localhost:8081/health' : 'GET http://localhost:8082/health',
      file: service === 'estoque-service' ? 'backend/estoque-service/main.go' : 'backend/faturamento-service/main.go',
      path: 'GET /health',
    } satisfies ServiceHealth;
  }

  private faultFromHealth(health: ServiceHealth): SystemFault | null {
    if (health.status === 'ok') {
      return null;
    }
    if (health.failureMode) {
      return {
        code: 'NF-EST-001',
        phrase: 'Estoque em modo degradado',
        service: health.service || 'estoque-service',
        location: health.location || 'func (s *server) health',
        file: health.file || 'backend/estoque-service/main.go',
        path: health.path || 'GET /health',
        hint: 'Clique em Corrigir para retirar o estoque do modo degradado e recarregar os dados.',
        recoverable: true,
      };
    }
    return {
      code: health.code || 'NF-SYS-001',
      phrase: `${health.service || 'Servico'} nao respondeu ao diagnostico`,
      service: health.service || 'servico-local',
      location: health.location || 'health check HTTP',
      file: health.file || 'docker-compose.yml',
      path: health.path || 'GET /health',
      hint: 'Inicie os containers pelo Docker Desktop ou rode docker compose up -d.',
      recoverable: false,
    };
  }

  private formatSystemFault(fault: SystemFault): string {
    return [
      `[${fault.code}] ${fault.phrase}`,
      `servico: ${fault.service}`,
      `local: ${fault.location}`,
      `arquivo: ${fault.file}`,
      `endpoint: ${fault.path}`,
      `acao: ${fault.hint}`,
    ].join('\n');
  }

  selectedProduct(): Product | undefined {
    return this.products.find((item) => item.code === this.itemForm.productCode);
  }

  selectedPricingProduct(): Product | undefined {
    return this.products.find((item) => item.code === this.pricingProductCode);
  }

  selectedPricingChannel(): PricingChannel {
    return this.pricingChannels.find((channel) => channel.id === this.selectedPricingChannelId)
      ?? this.pricingChannels[0]
      ?? this.defaultPricingChannels()[0];
  }

  addPricingChannel(type: PricingChannelType): void {
    const channel: PricingChannel = {
      id: crypto.randomUUID ? crypto.randomUUID() : `canal-${Date.now()}`,
      name: type === 'physical' ? 'Nova loja fisica' : 'Nova loja virtual',
      type,
      paymentFeePercent: type === 'physical' ? 1.5 : 4.99,
      paymentFeeFixed: 0,
      marketplaceFeePercent: type === 'physical' ? 0 : 12,
      fixedCostPercent: type === 'physical' ? 8 : 4,
      trafficCost: type === 'physical' ? 0 : 12,
      packagingCost: type === 'physical' ? 0.5 : 3.5,
      targetMarginPercent: 20,
    };
    this.pricingChannels = [...this.pricingChannels, channel];
    this.selectedPricingChannelId = channel.id;
    this.persistPricingChannels();
  }

  removePricingChannel(channel: PricingChannel): void {
    if (this.pricingChannels.length <= 1) {
      this.showAlert('info', 'Mantenha pelo menos um canal de venda.');
      return;
    }
    this.pricingChannels = this.pricingChannels.filter((item) => item.id !== channel.id);
    if (this.selectedPricingChannelId === channel.id) {
      this.selectedPricingChannelId = this.pricingChannels[0].id;
    }
    this.persistPricingChannels();
  }

  updatePricingChannel(): void {
    this.persistPricingChannels();
  }

  updateSelectedPricingChannel(field: keyof PricingChannel, value: string | number): void {
    const channel = this.selectedPricingChannel();
    const nextValue = field === 'name' || field === 'type'
      ? value
      : this.parseMoney(value);
    (channel as unknown as Record<string, string | number>)[field] = nextValue;
    if (field === 'type') {
      channel.type = value === 'online' ? 'online' : 'physical';
    }
    this.persistPricingChannels();
  }

  syncPricingFromProduct(): void {
    const product = this.selectedPricingProduct();
    if (!product) {
      return;
    }
    this.pricingForm.productCost = this.parseMoney(product.purchasePrice);
    this.pricingForm.salePrice = this.parseMoney(product.salePrice);
    this.pricingForm.taxRatePercent = this.parseMoney(product.taxRate);
  }

  pricingResult(): PricingResult {
    const channel = this.selectedPricingChannel();
    const productCost = this.cleanMoney(this.pricingForm.productCost);
    const supplierFreight = this.cleanMoney(this.pricingForm.supplierFreight);
    const salePrice = this.cleanMoney(this.pricingForm.salePrice);
    const taxRate = this.cleanPercent(this.pricingForm.taxRatePercent);
    const paymentPercent = this.cleanPercent(channel.paymentFeePercent);
    const marketplacePercent = this.cleanPercent(channel.marketplaceFeePercent);
    const fixedCostPercent = this.cleanPercent(channel.fixedCostPercent);
    const targetMargin = Math.min(this.cleanPercent(channel.targetMarginPercent), 0.95);
    const paymentFixed = this.cleanMoney(channel.paymentFeeFixed);
    const trafficCost = this.cleanMoney(channel.trafficCost);
    const packagingCost = this.cleanMoney(channel.packagingCost);
    const productBaseCost = productCost + supplierFreight + packagingCost;
    const taxValue = salePrice * taxRate;
    const paymentFee = salePrice * paymentPercent + paymentFixed;
    const marketplaceFee = salePrice * marketplacePercent;
    const fixedCost = salePrice * fixedCostPercent;
    const channelCost = paymentFee + marketplaceFee + fixedCost + trafficCost;
    const totalCost = productBaseCost + taxValue + channelCost;
    const netProfit = salePrice - totalCost;
    const netMargin = salePrice > 0 ? netProfit / salePrice * 100 : 0;
    const markup = productBaseCost > 0 ? (salePrice - productBaseCost) / productBaseCost * 100 : 0;
    const breakEvenPrice = this.solveSuggestedPrice(productBaseCost, taxRate, paymentPercent, paymentFixed, marketplacePercent, fixedCostPercent, trafficCost, 0);
    const suggestedPrice = this.solveSuggestedPrice(productBaseCost, taxRate, paymentPercent, paymentFixed, marketplacePercent, fixedCostPercent, trafficCost, targetMargin);
    const suggestedPriceValid = suggestedPrice > 0;
    const loss = Math.max(0, -netProfit);

    let status = 'Preencha os custos';
    let tone: PricingResult['tone'] = 'neutral';
    let advice = 'Escolha um produto, canal e margem alvo para calcular preco ideal.';
    if (salePrice > 0 && productBaseCost > 0) {
      if (netProfit < 0) {
        status = 'Prejuizo';
        tone = 'danger';
        advice = `Venda abaixo do custo total. Preco minimo estimado: ${this.formatMoney(breakEvenPrice)}.`;
      } else if (netMargin < 10) {
        status = 'Margem apertada';
        tone = 'warning';
        advice = `Ha lucro, mas pouca folga. Preco para margem alvo: ${this.formatMoney(suggestedPrice)}.`;
      } else {
        status = 'Lucro estimado';
        tone = 'success';
        advice = `Canal viavel. Lucro liquido por unidade: ${this.formatMoney(netProfit)}.`;
      }
    }

    return {
      productCost: this.round2(productBaseCost),
      salePrice: this.round2(salePrice),
      taxValue: this.round2(taxValue),
      paymentFee: this.round2(paymentFee),
      marketplaceFee: this.round2(marketplaceFee),
      fixedCost: this.round2(fixedCost),
      channelCost: this.round2(channelCost),
      totalCost: this.round2(totalCost),
      netProfit: this.round2(netProfit),
      loss: this.round2(loss),
      netMargin: this.round2(netMargin),
      markup: this.round2(markup),
      breakEvenPrice: this.round2(breakEvenPrice),
      suggestedPrice: this.round2(suggestedPrice),
      suggestedPriceValid,
      status,
      tone,
      advice,
    };
  }

  inventoryTotalQuantity(): number {
    return this.products.reduce((total, product) => total + Number(product.balance || 0), 0);
  }

  inventoryPurchaseValue(): number {
    return this.products.reduce(
      (total, product) => total + Number(product.balance || 0) * this.parseMoney(product.purchasePrice),
      0,
    );
  }

  inventorySaleValue(): number {
    return this.products.reduce(
      (total, product) => total + Number(product.balance || 0) * this.parseMoney(product.salePrice),
      0,
    );
  }

  inventoryEstimatedProfit(): number {
    return this.products.reduce((total, product) => {
      const quantity = Number(product.balance || 0);
      const unitProfit = this.parseMoney(product.salePrice) - this.parseMoney(product.purchasePrice);
      const tax = this.parseMoney(product.salePrice) * this.parseMoney(product.taxRate) / 100;
      return total + quantity * (unitProfit - tax);
    }, 0);
  }

  productsMissingNcm(): number {
    return this.products.filter((product) => !this.hasValidProductNcm(product)).length;
  }

  hasValidProductNcm(product: Product): boolean {
    return Boolean(product.ncm && product.ncm !== '0000.00.00' && this.onlyDigits(product.ncm).length === 8);
  }

  cashValue(): number {
    return this.ledgerInvoices
      .filter((invoice) => !['Cancelada', 'Inutilizada'].includes(invoice.status))
      .reduce((total, invoice) => total + this.parseMoney(invoice.amountPaid), 0);
  }

  invoiceTotalItems(invoice: Invoice): number {
    return invoice.items.reduce((total, item) => total + item.quantity, 0);
  }

  draftTotal(): number {
    return this.invoiceItems.reduce((total, item) => total + item.totalValue, 0);
  }

  draftTax(): number {
    return this.invoiceItems.reduce((total, item) => total + item.taxValue, 0);
  }

  statusClass(status: InvoiceStatus): string {
    return status
      .toLowerCase()
      .replace('enviadacontabilidade', 'sent')
      .replace('contingencia', 'contingency')
      .replace('autorizada', 'authorized')
      .replace('inutilizada', 'voided');
  }

  trackProduct(_: number, product: Product): string {
    return product.code;
  }

  trackInvoice(_: number, invoice: Invoice): number {
    return invoice.id;
  }

  trackInvoiceItem(_: number, item: InvoiceItem): string {
    return item.productCode;
  }

  private emptyProduct(): Product {
    return {
      code: '',
      description: '',
      packagingDescription: '',
      photoDataUrl: '',
      ncm: '',
      unit: 'UN',
      balance: 0,
      purchasePrice: 0,
      salePrice: 0,
      taxRate: 0,
      taxProfile: 'Padrao',
      cfop: '5102',
      csosn: '102',
      productType: 'Mercadoria para revenda',
      origin: 'Nacional',
      active: true,
    };
  }

  private normalizedProduct(product: Product): Product {
    return {
      ...product,
      code: product.code.trim(),
      description: product.description.trim(),
      packagingDescription: product.packagingDescription?.trim() || '',
      photoDataUrl: product.photoDataUrl?.trim() || '',
      ncm: product.ncm.trim(),
      unit: product.unit.trim() || 'UN',
      taxProfile: product.taxProfile.trim() || 'Padrao',
      cfop: product.cfop?.trim() || '5102',
      csosn: product.csosn?.trim() || '102',
      productType: product.productType?.trim() || 'Mercadoria para revenda',
      origin: product.origin.trim() || 'Nacional',
      balance: Number(product.balance || 0),
      purchasePrice: this.parseMoney(product.purchasePrice),
      salePrice: this.parseMoney(product.salePrice),
      taxRate: this.parseMoney(product.taxRate),
      active: product.active,
    };
  }

  private productValidationError(): string {
    const product = this.normalizedProduct(this.productForm);
    if (!product.code) {
      return 'Codigo do produto e obrigatorio.';
    }
    if (!product.description) {
      return 'Nome do produto e obrigatorio.';
    }
    if (!product.ncm || product.ncm === '0000.00.00' || this.onlyDigits(product.ncm).length !== 8) {
      return 'NCM valido e obrigatorio. Digite o nome do produto ou escolha uma sugestao de NCM.';
    }
    if (!product.cfop) {
      return 'CFOP e obrigatorio.';
    }
    if (!product.csosn) {
      return 'CSOSN/CST e obrigatorio.';
    }
    if (product.balance <= 0) {
      return 'Quantidade em estoque deve ser maior que zero.';
    }
    if (product.salePrice <= 0) {
      return 'Valor de venda deve ser maior que zero.';
    }
    if (product.purchasePrice < 0 || product.taxRate < 0) {
      return 'Valor comprado e tributacao nao podem ser negativos.';
    }
    return '';
  }

  private normalizedCertificate(settings: CertificateSettings): CertificateSettings {
    return {
      ...settings,
      companyState: this.normalizeState(settings.companyState) || this.detectRuntimeState(),
      taxRegime: settings.taxRegime || 'Simples Nacional',
      certificateYear: Number(settings.certificateYear || new Date().getFullYear()),
      certificateFileName: settings.certificateFileName || '',
      passwordConfigured: Boolean(settings.passwordConfigured),
      updatedAt: settings.updatedAt || '',
    };
  }

  private applyFiscalContextToProduct(): void {
    const defaultCode = this.isSimpleRegime() ? '102' : '00';
    if (!this.fiscalCodeOptions().includes(this.productForm.csosn)) {
      this.productForm.csosn = defaultCode;
    }
    this.productForm.cfop = this.defaultCfop();
    this.applyTaxEstimateForCurrentNcm();
  }

  onNcmChange(): void {
    this.applyTaxEstimateForCurrentNcm(true);
  }

  private applyTaxEstimateForCurrentNcm(force = false): void {
    if (!this.productForm.ncm || this.onlyDigits(this.productForm.ncm).length !== 8) {
      return;
    }
    const estimatedTaxRate = this.estimatedTaxRateForNcm(this.productForm.ncm);
    const profileAllowsEstimate =
      !this.productForm.taxProfile ||
      this.productForm.taxProfile === 'Padrao' ||
      this.productForm.taxProfile.startsWith('Classificacao pendente') ||
      this.productForm.taxProfile.startsWith('Aliquota estimada');
    if (force || this.productForm.taxRate <= 0 || profileAllowsEstimate) {
      this.productForm.taxRate = estimatedTaxRate;
      this.productForm.taxProfile = `Aliquota estimada por NCM, UF ${this.certificateForm.companyState} e regime ${this.certificateForm.taxRegime}`;
    }
  }

  private defaultCfop(): string {
    const origin = this.normalizeState(this.certificateForm.companyState);
    const destination = this.normalizeState(this.invoiceForm.customerState) || origin;
    return origin && destination && origin !== destination ? '6102' : '5102';
  }

  private estimatedTaxRateForNcm(ncm: string): number {
    if (this.certificateForm.taxRegime === 'MEI') {
      return 0;
    }
    if (this.certificateForm.taxRegime === 'Simples Nacional') {
      return this.simpleEstimatedTaxRate(ncm);
    }
    return this.standardEstimatedTaxRate(ncm);
  }

  private simpleEstimatedTaxRate(ncm: string): number {
    const standardRate = this.standardEstimatedTaxRate(ncm);
    return Math.min(standardRate, standardRate <= 12 ? 6 : 8);
  }

  private standardEstimatedTaxRate(ncm: string): number {
    const digits = this.onlyDigits(ncm);
    const chapter = Number(digits.slice(0, 2));
    const stateRate = this.stateInternalRate(this.certificateForm.companyState);

    if ([1, 2, 3, 4, 7, 8, 10, 11, 12].includes(chapter)) return 7;
    if ([16, 17, 18, 19, 20, 21, 22].includes(chapter)) return 12;
    if (chapter === 27) return 18;
    if (chapter === 30) return 12;
    if ([50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64].includes(chapter)) return 12;
    if ([72, 73, 74, 76, 82, 83].includes(chapter)) return 12;
    if ([84, 85, 90, 91, 94, 95, 96].includes(chapter)) return stateRate;
    if (chapter === 87) return 12;
    return stateRate;
  }

  private stateInternalRate(state: string): number {
    const normalizedState = this.normalizeState(state);
    const rates: Record<string, number> = {
      AC: 19,
      AL: 19,
      AP: 18,
      AM: 20,
      BA: 20.5,
      CE: 20,
      DF: 20,
      ES: 17,
      GO: 19,
      MA: 22,
      MT: 17,
      MS: 17,
      MG: 18,
      PA: 19,
      PB: 20,
      PR: 19.5,
      PE: 20.5,
      PI: 21,
      RJ: 22,
      RN: 20,
      RS: 17,
      RO: 19.5,
      RR: 20,
      SC: 17,
      SP: 18,
      SE: 19,
      TO: 20,
    };
    return rates[normalizedState] ?? 18;
  }

  private detectStateFromText(text: string): string {
    const normalized = this.normalizeSearchText(text);
    const tokens = new Set(this.searchTokens(normalized).map((token) => token.toUpperCase()));
    for (const state of this.states) {
      if (tokens.has(state)) {
        return state;
      }
    }
    const stateNames: Record<string, string> = {
      acre: 'AC',
      alagoas: 'AL',
      amapa: 'AP',
      amazonas: 'AM',
      bahia: 'BA',
      ceara: 'CE',
      'distrito federal': 'DF',
      'espirito santo': 'ES',
      goias: 'GO',
      maranhao: 'MA',
      'mato grosso do sul': 'MS',
      'mato grosso': 'MT',
      'minas gerais': 'MG',
      paraiba: 'PB',
      parana: 'PR',
      pernambuco: 'PE',
      piaui: 'PI',
      'rio de janeiro': 'RJ',
      'rio grande do norte': 'RN',
      'rio grande do sul': 'RS',
      rondonia: 'RO',
      roraima: 'RR',
      'santa catarina': 'SC',
      'sao paulo': 'SP',
      sergipe: 'SE',
      tocantins: 'TO',
    };
    for (const [name, state] of Object.entries(stateNames)) {
      if (normalized.includes(name)) {
        return state;
      }
    }
    return '';
  }

  private normalizeState(value: string | undefined): string {
    const state = String(value ?? '').trim().toUpperCase();
    return this.states.includes(state) ? state : '';
  }

  private detectRuntimeState(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/Fortaleza' ? 'CE' : 'SP';
  }

  paymentDifference(): number {
    return this.round2(this.parseMoney(this.invoiceForm.amountPaid) - this.draftTotal());
  }

  paymentLabel(): string {
    const diff = this.paymentDifference();
    if (diff > 0) return `Troco: ${this.formatMoney(diff)}`;
    if (diff < 0) return `Cliente fica devendo: ${this.formatMoney(Math.abs(diff))}`;
    return 'Pagamento exato';
  }

  onProductMoneyBlur(field: 'purchasePrice' | 'salePrice'): void {
    (this.productForm as unknown as Record<string, unknown>)[field] = this.formatMoneyInput(
      (this.productForm as unknown as Record<string, unknown>)[field],
    );
  }

  onInvoiceMoneyBlur(field: 'amountPaid'): void {
    (this.invoiceForm as unknown as Record<string, unknown>)[field] = this.formatMoneyInput(
      (this.invoiceForm as unknown as Record<string, unknown>)[field],
    );
  }

  onItemMoneyBlur(field: 'unitValue'): void {
    (this.itemForm as unknown as Record<string, unknown>)[field] = this.formatMoneyInput(
      (this.itemForm as unknown as Record<string, unknown>)[field],
    );
  }

  private async applyPhotoSuggestion(file: File): Promise<void> {
    const dataUrl = await this.fileToProductPhotoDataUrl(file);
    this.productForm.photoDataUrl = dataUrl;
    this.photoPreviewUrl = dataUrl;
    this.readingPhoto = true;
    let detectedText = file.name;
    let typography = this.emptyPackageTypography();
    try {
      typography = await this.runLocalPackagingOcr(file);
      detectedText = `${file.name} ${typography.rawText}`;
    } catch {
      detectedText = file.name;
    }
    await this.ensureNcmDatabase();
    const visual = await this.classifyProductImage(file);
    const visualLooksReliable = visual.confidence >= 0.22;
    const searchableVisual = visualLooksReliable ? visual.labels : '';
    const catalogSuggestion = this.findCatalogSuggestion(`${detectedText} ${searchableVisual}`);
    const officialNcm = this.findOfficialNcmCandidate(`${detectedText} ${typography.title} ${typography.detail}`);
    const detectedState = this.detectStateFromText(`${detectedText} ${typography.detail}`);
    if (detectedState) {
      this.invoiceForm.customerState = detectedState;
    }
    const suggestion = officialNcm
      ? this.suggestionFromOfficialNcm(officialNcm, catalogSuggestion)
      : catalogSuggestion ?? this.fallbackSuggestion();
    this.productLookupText = this.compactLookupText(detectedText, visual.labels);
    this.productLookupMatches = this.rankCatalogSuggestions(this.productLookupText).slice(0, 5);
    this.applyCatalogSuggestion(suggestion);
    this.applyPackageTypography(typography);
    if (!this.productForm.code) {
      this.productForm.code = `P${String(Date.now()).slice(-5)}`;
    }
    const visionSummary = `${visual.labels || 'sem classe'}${visual.confidence ? ` (${Math.round(visual.confidence * 100)}%)` : ''}`;
    const typographySummary = typography.title
      ? ` Tipografia: nome "${typography.title}"${typography.detail ? `; descricao "${typography.detail}"` : ''}.`
      : '';
    const stateSummary = detectedState ? ` UF detectada: ${detectedState}.` : '';
    this.photoSuggestion = this.isFallbackSuggestion(suggestion)
      ? `Nao identifiquei com seguranca, entao nao gravei NCM inventado. Visao: ${visionSummary}.${typographySummary}${stateSummary} Digite uma palavra-chave abaixo, por exemplo antena, carrinho, capacete ou broca.`
      : `Preenchido automaticamente: ${suggestion.description}, NCM ${suggestion.ncm}, CFOP ${suggestion.cfop}, CSOSN/CST ${suggestion.csosn}, aliquota ${suggestion.taxRate}%. ${officialNcm ? `Base ${this.ncmSource}. Termos: ${officialNcm.matchedTokens.join(', ')}. ` : ''}Visao: ${visionSummary}.${typographySummary}${stateSummary}`;
    this.readingPhoto = false;
  }

  private async classifyProductImage(file: File): Promise<{ labels: string; confidence: number }> {
    try {
      await import('@tensorflow/tfjs');
      const mobilenet = await import('@tensorflow-models/mobilenet');
      this.visionModel ??= await mobilenet.load({ version: 2, alpha: 1.0 });
      const image = await this.fileToImage(file);
      const predictions = await this.visionModel.classify(image, 5);
      return {
        labels: predictions.map((prediction) => prediction.className).join(' '),
        confidence: predictions[0]?.probability ?? 0,
      };
    } catch {
      return { labels: '', confidence: 0 };
    }
  }

  private async runLocalPackagingOcr(file: File): Promise<PackageTypography> {
    const image = await this.fileToImage(file);
    const sources = this.createOcrSources(image);
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('por+eng');
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: '11' as never,
        preserve_interword_spaces: '1',
      });
      const attempts: PackageTypography[] = [];
      for (const source of sources) {
        const result = await worker.recognize(source.canvas);
        attempts.push(this.extractPackageTypography(result, source.label));
      }
      return this.mergePackageTypography(attempts);
    } finally {
      await worker.terminate();
    }
  }

  private ensureNcmDatabase(): Promise<void> {
    this.ncmLoad ??= fetch('data/ncm-siscomex.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Tabela NCM local indisponivel');
        }
        return response.json() as Promise<NcmDatabase>;
      })
      .then((database) => {
        this.ncmSource = `${database.Data_Ultima_Atualizacao_NCM} - ${database.Ato}`;
        this.ncmEntries = database.Nomenclaturas.filter((entry) => this.onlyDigits(entry.Codigo).length === 8)
          .map((entry) => {
            const description = this.cleanOcrText(entry.Descricao.replace(/<[^>]+>/g, ' '));
            const searchText = this.normalizeSearchText(`${entry.Codigo} ${description}`);
            return {
              code: entry.Codigo,
              description,
              searchText,
              tokens: this.searchTokens(searchText).filter((token) => !this.isNcmStopword(token)),
            };
          })
          .filter((entry) => entry.description && entry.tokens.length > 0);
      })
      .catch(() => {
        this.ncmSource = 'Tabela NCM local nao carregada';
        this.ncmEntries = [];
      });
    return this.ncmLoad;
  }

  private findOfficialNcmCandidate(text: string): NcmCandidate | undefined {
    return this.findOfficialNcmCandidates(text, 1, 18)[0];
  }

  private quickNcmCandidatesFromCatalog(text: string): NcmCandidate[] {
    return this.rankCatalogSuggestions(text).map((match) => ({
      entry: {
        code: match.suggestion.ncm,
        description: match.suggestion.taxProfile,
        searchText: this.normalizeSearchText(`${match.suggestion.ncm} ${match.suggestion.description} ${match.suggestion.taxProfile}`),
        tokens: match.suggestion.keywords.map((keyword) => this.normalizeSearchText(keyword)),
      },
      score: match.score + 10,
      matchedTokens: match.matchedKeywords,
    }));
  }

  private mergeNcmCandidates(candidates: NcmCandidate[]): NcmCandidate[] {
    const byCode = new Map<string, NcmCandidate>();
    for (const candidate of candidates) {
      const existing = byCode.get(candidate.entry.code);
      if (!existing || candidate.score > existing.score) {
        byCode.set(candidate.entry.code, candidate);
      }
    }
    return Array.from(byCode.values()).sort(
      (left, right) => right.score - left.score || left.entry.description.localeCompare(right.entry.description),
    );
  }

  private findOfficialNcmCandidates(text: string, limit: number, minScore: number): NcmCandidate[] {
    if (this.ncmEntries.length === 0) {
      return [];
    }
    const expandedText = this.expandCommercialNcmText(text);
    const queryTokens = this.expandQueryTokens(this.searchTokens(this.normalizeSearchText(expandedText)))
      .map((token) => this.singularToken(token))
      .filter((token) => this.isSearchableQueryToken(token) && !this.isNcmStopword(token));
    if (queryTokens.length === 0) {
      return [];
    }
    const uniqueQueryTokens = Array.from(new Set(queryTokens));
    const queryTokenSet = new Set(uniqueQueryTokens);

    const ranked = this.ncmEntries
      .map((entry) => {
        const matchedTokens = this.matchNcmTokens(entry.tokens, uniqueQueryTokens);
        const score =
          matchedTokens.reduce((total, token) => total + this.ncmTokenWeight(token, queryTokenSet.has(token)), 0) +
          this.ncmPhraseScore(entry.searchText, uniqueQueryTokens) +
          this.ncmExactDescriptionScore(entry, uniqueQueryTokens);
        return { entry, score, matchedTokens };
      })
      .filter((candidate) => {
        const hasShortQuery = uniqueQueryTokens.some((token) => token.length <= 3);
        const enoughTokens = uniqueQueryTokens.length === 1 || hasShortQuery
          ? candidate.matchedTokens.length >= 1
          : candidate.matchedTokens.length >= 2;
        return candidate.score >= minScore && enoughTokens;
      })
      .sort((left, right) => right.score - left.score || right.matchedTokens.length - left.matchedTokens.length);

    return ranked
      .filter((candidate) => !this.isGenericNcmDescription(candidate.entry.description) || candidate.score >= 34)
      .slice(0, limit);
  }

  private suggestionFromOfficialNcm(candidate: NcmCandidate, catalogSuggestion?: CatalogSuggestion): CatalogSuggestion {
    const catalogForSameNcm = this.catalog.find((item) => item.ncm === candidate.entry.code) ?? catalogSuggestion;
    const estimatedTaxRate = this.estimatedTaxRateForNcm(candidate.entry.code);
    return {
      keywords: candidate.matchedTokens,
      description: catalogForSameNcm?.description ?? candidate.entry.description,
      ncm: candidate.entry.code,
      taxProfile: catalogForSameNcm?.taxProfile ?? `Aliquota estimada por capitulo NCM: ${candidate.entry.description}`,
      taxRate: catalogForSameNcm?.taxRate ?? estimatedTaxRate,
      cfop: this.defaultCfop(),
      csosn: catalogForSameNcm?.csosn ?? (this.isSimpleRegime() ? '102' : '00'),
      productType: catalogForSameNcm?.productType ?? 'Classificacao fiscal oficial',
      origin: catalogForSameNcm?.origin ?? 'Nacional',
    };
  }

  private createOcrSources(image: HTMLImageElement): OcrSource[] {
    const full = { x: 0, y: 0, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
    const object = this.detectForegroundBox(image) ?? full;
    const crops = [
      { label: 'foto completa', crop: full, mode: 'contrast' as const, maxSide: 2200 },
      { label: 'produto recortado', crop: this.expandCrop(object, full, 0.08), mode: 'contrast' as const, maxSide: 2400 },
      { label: 'rotulo central', crop: this.relativeCrop(object, full, 0.16, 0.18, 0.68, 0.64), mode: 'contrast' as const, maxSide: 2600 },
      { label: 'rotulo inferior', crop: this.relativeCrop(object, full, 0.12, 0.38, 0.76, 0.52), mode: 'contrast' as const, maxSide: 2400 },
      { label: 'rotulo alto contraste', crop: this.relativeCrop(object, full, 0.12, 0.18, 0.76, 0.70), mode: 'binary' as const, maxSide: 2400 },
    ];

    return crops
      .filter((item) => Number(item.crop.width ?? 0) >= 20 && Number(item.crop.height ?? 0) >= 20)
      .map((item) => ({
        label: item.label,
        canvas: this.renderOcrCanvas(image, item.crop, item.maxSide, item.mode),
      }));
  }

  private detectForegroundBox(image: HTMLImageElement): DOMRectInit | undefined {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const probeWidth = 240;
    const probeHeight = Math.max(1, Math.round(probeWidth * (height / width)));
    const canvas = document.createElement('canvas');
    canvas.width = probeWidth;
    canvas.height = probeHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return undefined;
    }
    context.drawImage(image, 0, 0, probeWidth, probeHeight);
    const data = context.getImageData(0, 0, probeWidth, probeHeight).data;
    let minX = probeWidth;
    let minY = probeHeight;
    let maxX = 0;
    let maxY = 0;
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < 20) continue;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const brightness = (r + g + b) / 3;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      const isBackground = brightness > 244 && spread < 18;
      if (isBackground) continue;
      const pixel = index / 4;
      const x = pixel % probeWidth;
      const y = Math.floor(pixel / probeWidth);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count++;
    }
    if (count < 30) {
      return undefined;
    }
    const scaleX = width / probeWidth;
    const scaleY = height / probeHeight;
    return {
      x: minX * scaleX,
      y: minY * scaleY,
      width: Math.max(1, (maxX - minX + 1) * scaleX),
      height: Math.max(1, (maxY - minY + 1) * scaleY),
    };
  }

  private relativeCrop(
    base: DOMRectInit,
    bounds: DOMRectInit,
    relativeX: number,
    relativeY: number,
    relativeWidth: number,
    relativeHeight: number,
  ): DOMRectInit {
    return this.clampCrop(
      {
        x: Number(base.x ?? 0) + Number(base.width ?? 0) * relativeX,
        y: Number(base.y ?? 0) + Number(base.height ?? 0) * relativeY,
        width: Number(base.width ?? 0) * relativeWidth,
        height: Number(base.height ?? 0) * relativeHeight,
      },
      bounds,
    );
  }

  private expandCrop(crop: DOMRectInit, bounds: DOMRectInit, ratio: number): DOMRectInit {
    const extraX = Number(crop.width ?? 0) * ratio;
    const extraY = Number(crop.height ?? 0) * ratio;
    return this.clampCrop(
      {
        x: Number(crop.x ?? 0) - extraX,
        y: Number(crop.y ?? 0) - extraY,
        width: Number(crop.width ?? 0) + extraX * 2,
        height: Number(crop.height ?? 0) + extraY * 2,
      },
      bounds,
    );
  }

  private clampCrop(crop: DOMRectInit, bounds: DOMRectInit): DOMRectInit {
    const boundsX = Number(bounds.x ?? 0);
    const boundsY = Number(bounds.y ?? 0);
    const boundsRight = boundsX + Number(bounds.width ?? 0);
    const boundsBottom = boundsY + Number(bounds.height ?? 0);
    const x = Math.max(boundsX, Number(crop.x ?? 0));
    const y = Math.max(boundsY, Number(crop.y ?? 0));
    const right = Math.min(boundsRight, x + Number(crop.width ?? 0));
    const bottom = Math.min(boundsBottom, y + Number(crop.height ?? 0));
    return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
  }

  private renderOcrCanvas(
    image: HTMLImageElement,
    crop: DOMRectInit,
    maxSide: number,
    mode: 'contrast' | 'binary',
  ): HTMLCanvasElement {
    const cropWidth = Math.max(1, Number(crop.width ?? image.width));
    const cropHeight = Math.max(1, Number(crop.height ?? image.height));
    const scale = Math.min(5, Math.max(2.2, maxSide / Math.max(cropWidth, cropHeight)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(cropWidth * scale);
    canvas.height = Math.round(cropHeight * scale);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return canvas;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      image,
      Number(crop.x ?? 0),
      Number(crop.y ?? 0),
      cropWidth,
      cropHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    this.applyOcrFilter(context, canvas.width, canvas.height, mode);
    return canvas;
  }

  private applyOcrFilter(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    mode: 'contrast' | 'binary',
  ): void {
    const imageData = context.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let index = 0; index < data.length; index += 4) {
      const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
      const contrasted = this.clampByte((gray - 128) * 1.9 + 128);
      const value = mode === 'binary' ? (contrasted > 152 ? 255 : 0) : contrasted;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
    }
    context.putImageData(imageData, 0, 0);
  }

  private clampByte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  private extractPackageTypography(result: unknown, sourceLabel = ''): PackageTypography {
    const data = (
      result as {
        data?: {
          text?: string;
          words?: Array<{
            text?: string;
            confidence?: number;
            bbox?: { x0?: number; y0?: number; x1?: number; y1?: number };
          }>;
        };
      }
    ).data;
    const rawText = this.cleanOcrText(data?.text ?? '');
    const words = (data?.words ?? [])
      .map((word) => {
        const bbox = word.bbox;
        const text = this.cleanOcrText(word.text ?? '');
        const height = Math.max(0, Number(bbox?.y1 ?? 0) - Number(bbox?.y0 ?? 0));
        return {
          text,
          confidence: Number(word.confidence ?? 0),
          x0: Number(bbox?.x0 ?? 0),
          y0: Number(bbox?.y0 ?? 0),
          y1: Number(bbox?.y1 ?? 0),
          height,
          centerY: (Number(bbox?.y0 ?? 0) + Number(bbox?.y1 ?? 0)) / 2,
        };
      })
      .filter((word) => word.text.length >= 2 && word.height > 0 && word.confidence >= 35)
      .sort((left, right) => left.centerY - right.centerY || left.x0 - right.x0);

    if (words.length === 0) {
      return {
        title: '',
        detail: rawText.slice(0, 220),
        rawText,
        score: rawText.length > 0 ? 1 : 0,
      };
    }

    const lines: Array<{ text: string; avgHeight: number; centerY: number }> = [];
    for (const word of words) {
      const line = lines.find((candidate) => Math.abs(candidate.centerY - word.centerY) <= Math.max(8, word.height * 0.7));
      if (!line) {
        lines.push({ text: word.text, avgHeight: word.height, centerY: word.centerY });
        continue;
      }
      line.text = `${line.text} ${word.text}`;
      line.avgHeight = (line.avgHeight + word.height) / 2;
      line.centerY = (line.centerY + word.centerY) / 2;
    }

    const cleanLines = lines
      .map((line) => ({ ...line, text: this.cleanOcrText(line.text) }))
      .filter((line) => line.text.length >= 2)
      .sort((left, right) => right.avgHeight - left.avgHeight);
    const titleLine = cleanLines[0];
    if (!titleLine) {
      return { title: '', detail: rawText.slice(0, 220), rawText, score: rawText.length > 0 ? 1 : 0 };
    }

    const title = titleLine.text.slice(0, 60);
    const detail = this.uniqueTexts(
      cleanLines
        .filter((line) => line !== titleLine && line.avgHeight <= titleLine.avgHeight * 0.92)
        .sort((left, right) => left.centerY - right.centerY)
        .map((line) => line.text),
    )
      .join(' | ')
      .slice(0, 220);

    return {
      title,
      detail: detail || this.removeText(rawText, title).slice(0, 220),
      rawText,
      score: this.typographyScore(title, detail, rawText, sourceLabel),
    };
  }

  private mergePackageTypography(attempts: PackageTypography[]): PackageTypography {
    const meaningfulAttempts = attempts.filter((attempt) => attempt.rawText || attempt.title || attempt.detail);
    if (meaningfulAttempts.length === 0) {
      return this.emptyPackageTypography();
    }

    const bestTitle = meaningfulAttempts
      .filter((attempt) => this.isUsefulOcrTitle(attempt.title))
      .sort((left, right) => right.score - left.score || right.title.length - left.title.length)[0];
    const title = bestTitle?.title ?? '';
    const detail = this.uniqueTexts(
      meaningfulAttempts.flatMap((attempt) => [attempt.detail, this.removeText(attempt.rawText, title)]),
    )
      .filter((text) => text.length >= 3 && this.normalizeSearchText(text) !== this.normalizeSearchText(title))
      .join(' | ')
      .slice(0, 260);
    const rawText = this.uniqueTexts(meaningfulAttempts.map((attempt) => attempt.rawText))
      .join(' ')
      .slice(0, 420);

    return {
      title,
      detail,
      rawText,
      score: bestTitle?.score ?? 0,
    };
  }

  private typographyScore(title: string, detail: string, rawText: string, sourceLabel: string): number {
    const normalizedTitle = this.normalizeSearchText(title);
    const normalizedRaw = this.normalizeSearchText(`${rawText} ${detail}`);
    let score = Math.min(30, title.length * 1.5);
    if (/[A-Z]{3,}/.test(title)) score += 12;
    if (/\d/.test(title)) score += 4;
    if (sourceLabel.includes('rotulo')) score += 8;
    if (normalizedRaw.includes('lubrax')) score += normalizedTitle.includes('lubrax') ? 35 : 18;
    if (normalizedRaw.includes('15w') || normalizedRaw.includes('sae')) score += 14;
    if (normalizedRaw.includes('lubrificante') || normalizedRaw.includes('oleo')) score += 16;
    if (this.looksLikeOcrNoise(title)) score -= 28;
    return score;
  }

  private isUsefulOcrTitle(text: string): boolean {
    const normalized = this.normalizeSearchText(text);
    if (normalized.length < 3 || this.looksLikeOcrNoise(text)) {
      return false;
    }
    return /[a-z]/.test(normalized);
  }

  private looksLikeOcrNoise(text: string): boolean {
    const normalized = this.normalizeSearchText(text);
    const tokens = this.searchTokens(normalized);
    if (tokens.length === 0) {
      return true;
    }
    const singleCharTokens = tokens.filter((token) => token.length === 1).length;
    return singleCharTokens > 1 && singleCharTokens >= tokens.length / 2;
  }

  private applyPackageTypography(typography: PackageTypography): void {
    if (typography.title.length >= 2) {
      this.productForm.description = typography.title;
    }
    if (typography.detail.length >= 2) {
      this.productForm.packagingDescription = typography.detail;
    }
  }

  private fileToImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Imagem invalida'));
      };
      image.src = url;
    });
  }

  private async fileToProductPhotoDataUrl(file: File): Promise<string> {
    const image = await this.fileToImage(file);
    const maxSide = 640;
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return '';
    }
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.82);
  }

  private findCatalogSuggestion(text: string): CatalogSuggestion | undefined {
    const match = this.rankCatalogSuggestions(text)[0];
    return match && match.score >= 5 ? match.suggestion : undefined;
  }

  private rankCatalogSuggestions(text: string): CatalogMatch[] {
    const normalized = this.normalizeSearchText(text);
    const tokens = this.searchTokens(normalized);
    if (tokens.length === 0) {
      return [];
    }

    return this.catalog
      .map((suggestion) => {
        const matchedKeywords: string[] = [];
        const score = suggestion.keywords.reduce((total, keyword) => {
          const normalizedKeyword = this.normalizeSearchText(keyword);
          const keywordTokens = this.searchTokens(normalizedKeyword);
          if (keywordTokens.length === 0) {
            return total;
          }
          const matches =
            keywordTokens.length === 1
              ? this.hasTokenMatch(tokens, keywordTokens[0])
              : this.hasTokenSequence(tokens, keywordTokens);
          if (!matches) {
            return total;
          }
          matchedKeywords.push(keyword);
          if (keywordTokens.length > 1) {
            return total + 12 + keywordTokens.length;
          }
          if (keywordTokens[0].length <= 2) {
            return total + 2;
          }
          return total + (/\d/.test(keywordTokens[0]) ? 10 : 7);
        }, 0);

        return { suggestion, score, matchedKeywords };
      })
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score || left.suggestion.description.localeCompare(right.suggestion.description));
  }

  private searchTokens(text: string): string[] {
    return text.match(/[a-z0-9]+/g) ?? [];
  }

  private hasTokenMatch(tokens: string[], keyword: string): boolean {
    if (tokens.includes(keyword)) {
      return true;
    }
    if (keyword.length < 3) {
      return tokens.some((token) => token.length >= 2 && token.length <= 4 && token.startsWith(keyword));
    }
    return tokens.some((token) => token.startsWith(keyword) || keyword.startsWith(token));
  }

  private hasTokenSequence(tokens: string[], sequence: string[]): boolean {
    return tokens.some((_, index) =>
      sequence.every((sequenceToken, sequenceIndex) => tokens[index + sequenceIndex] === sequenceToken),
    );
  }

  private expandQueryTokens(tokens: string[]): string[] {
    const expanded = new Set<string>();
    for (const token of tokens) {
      expanded.add(token);
      if (token.length === 2) {
        expanded.add(`${token}s`);
      }
    }
    return Array.from(expanded);
  }

  private isSearchableQueryToken(token: string): boolean {
    return token.length >= 2;
  }

  private matchNcmTokens(entryTokens: string[], queryTokens: string[]): string[] {
    const matches = new Set<string>();
    const normalizedEntryTokens = entryTokens.map((token) => this.singularToken(token));
    for (const queryToken of queryTokens) {
      const exact = normalizedEntryTokens.find((token) => token === queryToken);
      if (exact) {
        matches.add(exact);
        continue;
      }
      const prefix = normalizedEntryTokens.find((token) => this.isPrefixCandidate(queryToken, token));
      if (prefix) {
        matches.add(prefix);
      }
    }
    return Array.from(matches);
  }

  private isPrefixCandidate(queryToken: string, entryToken: string): boolean {
    if (queryToken.length < 2 || entryToken.length < queryToken.length) {
      return false;
    }
    if (!entryToken.startsWith(queryToken)) {
      return false;
    }
    if (queryToken.length === 2) {
      return entryToken.length <= 4;
    }
    return entryToken.length <= Math.max(6, queryToken.length + 7);
  }

  private ncmTokenWeight(token: string, exactMatch = true): number {
    if (!exactMatch && token.length <= 4) return 5;
    if (!exactMatch) return 4;
    if (/\d/.test(token)) return 12;
    if (token.length >= 10) return 12;
    if (token.length >= 7) return 9;
    return 6;
  }

  private ncmPhraseScore(searchText: string, queryTokens: string[]): number {
    let score = 0;
    for (let index = 0; index < queryTokens.length - 1; index++) {
      const phrase = `${queryTokens[index]} ${queryTokens[index + 1]}`;
      if (searchText.includes(phrase)) {
        score += 10;
      }
    }
    return score;
  }

  private ncmExactDescriptionScore(entry: NcmEntry, queryTokens: string[]): number {
    const descriptionTokens = new Set(entry.tokens.map((token) => this.singularToken(token)));
    let score = 0;
    for (const token of queryTokens) {
      if (descriptionTokens.has(token)) {
        score += token.length <= 3 ? 4 : 14;
      }
    }
    if (queryTokens.length === 1 && descriptionTokens.has(queryTokens[0])) {
      score += 12;
    }
    return score;
  }

  private isNcmStopword(token: string): boolean {
    return new Set([
      'com',
      'sem',
      'para',
      'por',
      'de',
      'do',
      'da',
      'das',
      'dos',
      'e',
      'a',
      'o',
      'as',
      'os',
      'ao',
      'aos',
      'em',
      'no',
      'na',
      'uma',
      'uns',
      'nas',
      'nos',
      'que',
      'sua',
      'suas',
      'seus',
      'outro',
      'outra',
      'outros',
      'outras',
      'produto',
      'produtos',
      'artigo',
      'artigos',
      'parte',
      'partes',
      'tipo',
      'tipos',
      'qualquer',
      'semelhante',
      'semelhantes',
    ]).has(token);
  }

  private isGenericNcmDescription(description: string): boolean {
    const normalized = this.normalizeSearchText(description);
    return ['outros', 'outras', 'partes', 'acessorios'].some((word) => normalized === word || normalized === `- ${word}`);
  }

  private singularToken(token: string): string {
    if (token.length > 4 && token.endsWith('es')) {
      return token.slice(0, -2);
    }
    if (token.length > 4 && token.endsWith('s')) {
      return token.slice(0, -1);
    }
    return token;
  }

  private onlyDigits(value: string): string {
    return value.replace(/\D/g, '');
  }

  private applyCatalogSuggestion(suggestion: CatalogSuggestion): void {
    this.productForm.description = suggestion.description;
    this.productForm.packagingDescription ||= '';
    this.applyFiscalSuggestionOnly(suggestion);
    this.productForm.productType = suggestion.productType;
    this.productForm.origin = suggestion.origin;
  }

  private applyFiscalSuggestionOnly(suggestion: CatalogSuggestion): void {
    this.productForm.ncm = suggestion.ncm;
    this.productForm.taxProfile = suggestion.taxProfile;
    this.productForm.taxRate = suggestion.taxRate;
    this.productForm.cfop = this.defaultCfop();
    this.productForm.csosn = this.fiscalCodeOptions().includes(suggestion.csosn)
      ? suggestion.csosn
      : this.isSimpleRegime()
        ? '102'
        : '00';
    this.productForm.productType = suggestion.productType || this.productForm.productType;
    this.productForm.origin = suggestion.origin || this.productForm.origin;
  }

  private fallbackSuggestion(): CatalogSuggestion {
    return {
      keywords: [],
      description: 'Produto nao identificado com seguranca',
      ncm: '0000.00.00',
      taxProfile: 'Classificacao pendente - informe NCM antes de emitir',
      taxRate: 0,
      cfop: this.defaultCfop(),
      csosn: this.isSimpleRegime() ? '102' : '00',
      productType: 'Pendente de classificacao',
      origin: 'Nacional',
    };
  }

  private isFallbackSuggestion(suggestion: CatalogSuggestion): boolean {
    return suggestion.ncm === '0000.00.00';
  }

  private emptyPackageTypography(): PackageTypography {
    return { title: '', detail: '', rawText: '', score: 0 };
  }

  private compactLookupText(detectedText: string, visualLabels: string): string {
    return `${detectedText} ${visualLabels}`
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);
  }

  private expandCommercialNcmText(text: string): string {
    const normalized = this.normalizeSearchText(text);
    const tokens = this.searchTokens(normalized).map((token) => this.singularToken(token));
    const expanded = new Set<string>([text]);
    for (const token of tokens) {
      const aliases = this.ncmSearchAliases[token];
      if (aliases) {
        aliases.forEach((alias) => expanded.add(alias));
      }
    }
    return Array.from(expanded).join(' ');
  }

  private normalizeSearchText(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private cleanOcrText(text: string): string {
    return text
      .replace(/[^\p{L}\p{N}\s.,;:()/%+-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private uniqueTexts(texts: string[]): string[] {
    const seen = new Set<string>();
    return texts.filter((text) => {
      const key = this.normalizeSearchText(text);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private removeText(text: string, value: string): string {
    return this.cleanOcrText(text.replace(value, ''));
  }

  private formatMoney(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  private formatMoneyInput(value: unknown): string {
    return this.parseMoney(value).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    });
  }

  private parseMoney(value: unknown): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    const raw = String(value ?? '').trim();
    if (!raw) {
      return 0;
    }
    const cleaned = raw.replace(/[^\d,.-]/g, '');
    const normalized = cleaned.includes(',')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private cleanMoney(value: unknown): number {
    const parsed = this.parseMoney(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  private cleanPercent(value: unknown): number {
    return Math.min(this.cleanMoney(value) / 100, 0.99);
  }

  private solveSuggestedPrice(
    productBaseCost: number,
    taxRate: number,
    paymentPercent: number,
    paymentFixed: number,
    marketplacePercent: number,
    fixedCostPercent: number,
    trafficCost: number,
    targetMargin: number,
  ): number {
    const variableCost = taxRate + paymentPercent + marketplacePercent + fixedCostPercent + targetMargin;
    const denominator = 1 - variableCost;
    if (denominator <= 0.0001) {
      return 0;
    }
    return (productBaseCost + paymentFixed + trafficCost) / denominator;
  }

  private loadPricingChannels(): PricingChannel[] {
    try {
      const stored = localStorage.getItem('nf-pricing-channels');
      if (stored) {
        const parsed = JSON.parse(stored) as PricingChannel[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((channel) => ({ ...this.defaultPricingChannels()[0], ...channel }));
        }
      }
    } catch {
      localStorage.removeItem('nf-pricing-channels');
    }
    return this.defaultPricingChannels();
  }

  private persistPricingChannels(): void {
    localStorage.setItem('nf-pricing-channels', JSON.stringify(this.pricingChannels));
  }

  private defaultPricingChannels(): PricingChannel[] {
    return [
      {
        id: 'loja-fisica',
        name: 'Loja fisica padrao',
        type: 'physical',
        paymentFeePercent: 1.5,
        paymentFeeFixed: 0,
        marketplaceFeePercent: 0,
        fixedCostPercent: 8,
        trafficCost: 0,
        packagingCost: 0.5,
        targetMarginPercent: 20,
      },
      {
        id: 'loja-virtual',
        name: 'Loja virtual padrao',
        type: 'online',
        paymentFeePercent: 4.99,
        paymentFeeFixed: 0.4,
        marketplaceFeePercent: 12,
        fixedCostPercent: 4,
        trafficCost: 12,
        packagingCost: 3.5,
        targetMarginPercent: 20,
      },
    ];
  }

  private invoiceFilters(): { year?: number; month?: number; status?: string } {
    return {
      year: this.filterYear,
      month: this.filterMonth || undefined,
      status: this.filterStatus === 'Todos' ? undefined : this.filterStatus,
    };
  }

  private refreshSelectedInvoice(invoices: Invoice[]): void {
    if (!this.selectedInvoice) {
      return;
    }
    this.selectedInvoice = invoices.find((invoice) => invoice.id === this.selectedInvoice?.id) ?? this.selectedInvoice;
  }

  private newIdempotencyKey(invoiceId: number): string {
    const random = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    return `issue-${invoiceId}-${random}`;
  }

  private downloadText(fileName: string, content: string, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private showAlert(type: 'success' | 'error' | 'info', text: string): void {
    this.alert = { type, text };
  }

  private showError(error: unknown, fallback: string): void {
    if (error instanceof HttpErrorResponse && error.error) {
      const payload = error.error as ApiErrorPayload;
      const fault = this.faultFromApiError(payload);
      if (fault) {
        this.systemFault = fault;
        this.stockFailure = fault.service === 'estoque-service';
      }
      this.showAlert('error', this.formatApiError(payload, fallback));
      return;
    }
    this.showAlert('error', fallback);
  }

  private faultFromApiError(error: ApiErrorPayload): SystemFault | null {
    if (!error.code && !error.service) {
      return null;
    }
    return {
      code: error.code || 'NF-SYS-ERRO',
      phrase: error.phrase || 'Falha detectada durante a operacao',
      service: error.service || 'servico-local',
      location: error.location || 'operacao HTTP',
      file: error.file || 'backend',
      path: error.path || '-',
      hint: error.hint || 'Rode o diagnostico para verificar os microsservicos.',
      recoverable: error.code === 'NF-EST-001' || error.upstreamCode === 'NF-EST-001',
    };
  }

  private formatApiError(error: ApiErrorPayload, fallback: string): string {
    if (!error.code && !error.error) {
      return fallback;
    }
    const lines = [
      `[${error.code ?? 'NF-ERRO'}] ${error.phrase ?? 'Erro na operacao'}`,
      `mensagem: ${error.error ?? fallback}`,
    ];
    if (error.service) lines.push(`servico: ${error.service}`);
    if (error.location) lines.push(`local: ${error.location}`);
    if (error.file) lines.push(`arquivo: ${error.file}`);
    if (error.path) lines.push(`endpoint: ${error.path}`);
    if (error.upstreamCode) {
      lines.push('');
      lines.push('causa original:');
      lines.push(`[${error.upstreamCode}] ${error.upstreamService ?? 'servico externo'}`);
      lines.push(`local: ${error.upstreamLocation ?? '-'}`);
      lines.push(`arquivo: ${error.upstreamFile ?? '-'}`);
      lines.push(`endpoint: ${error.upstreamPath ?? '-'}`);
    }
    if (error.hint) {
      lines.push('');
      lines.push(`acao: ${error.hint}`);
    }
    return lines.join('\n');
  }
}
