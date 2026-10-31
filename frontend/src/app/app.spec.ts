import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { App } from './app';
import { ApiService } from './api.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: ApiService,
          useValue: {
            getProducts: () => of([]),
            getInvoices: () => of([]),
            saveProduct: () => of({ code: 'P001', description: 'Produto', balance: 10 }),
            updateProduct: () => of({ code: 'P001', description: 'Produto', balance: 10 }),
            deleteProduct: () => of(undefined),
            adjustStock: () => of({ code: 'P001', description: 'Produto', balance: 10 }),
            setStockFailure: () => of({ failureMode: false }),
            getStockHealth: () => of({ status: 'ok', service: 'estoque-service' }),
            getBillingHealth: () => of({ status: 'ok', service: 'faturamento-service' }),
            createInvoice: () => of({ id: 1, number: 1, status: 'Aberta', items: [] }),
            issueInvoice: () => of({ id: 1, number: 1, status: 'Autorizada', items: [] }),
            sendAccounting: () => of({ invoice: { id: 1, number: 1, status: 'EnviadaContabilidade', items: [] }, xml: '', emailDraft: '', message: '' }),
            sendAccountingPeriod: () => of({ invoices: [], xml: '', emailDraft: '', message: '' }),
            getCertificateSettings: () => of({ companyName: '', companyDocument: '', companyState: 'CE', taxRegime: 'Simples Nacional', certificateYear: 2026, certificateFileName: '', passwordConfigured: false, updatedAt: '' }),
            saveCertificateSettings: () => of({ companyName: '', companyDocument: '', companyState: 'CE', taxRegime: 'Simples Nacional', certificateYear: 2026, certificateFileName: '', passwordConfigured: true, updatedAt: '' }),
            cancelInvoice: () => of({ id: 1, number: 1, status: 'Cancelada', items: [] }),
            markContingency: () => of({ id: 1, number: 1, status: 'Contingencia', items: [] }),
            voidInvoice: () => of({ id: 1, number: 1, status: 'Inutilizada', items: [] }),
            getInvoiceXml: () => of({ xml: '' }),
          },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Tributo em Foco');
  });
});
