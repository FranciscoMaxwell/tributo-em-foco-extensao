import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export type InvoiceStatus =
  | 'Aberta'
  | 'Autorizada'
  | 'Contingencia'
  | 'EnviadaContabilidade'
  | 'Cancelada'
  | 'Inutilizada';

export interface Product {
  code: string;
  description: string;
  packagingDescription: string;
  photoDataUrl: string;
  ncm: string;
  unit: string;
  balance: number;
  purchasePrice: number;
  salePrice: number;
  taxRate: number;
  taxProfile: string;
  cfop: string;
  csosn: string;
  productType: string;
  origin: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface InvoiceItem {
  id?: number;
  productCode: string;
  description: string;
  ncm: string;
  quantity: number;
  unitValue: number;
  purchaseValue: number;
  taxRate: number;
  taxValue: number;
  totalValue: number;
}

export interface Invoice {
  id: number;
  number: number;
  status: InvoiceStatus;
  customerName: string;
  customerDocument: string;
  customerEmail: string;
  customerState: string;
  accountingEmail: string;
  paymentMethod: string;
  paymentStatus: string;
  amountPaid: number;
  dueDate: string;
  issueYear: number;
  issueMonth: number;
  totalPurchase: number;
  totalSale: number;
  totalTax: number;
  xmlContent?: string;
  emailDraft?: string;
  cancelReason?: string;
  items: InvoiceItem[];
  createdAt: string;
  closedAt?: string;
  sentAt?: string;
}

export interface CreateInvoiceRequest {
  customerName: string;
  customerDocument: string;
  customerEmail: string;
  customerState: string;
  accountingEmail: string;
  paymentMethod: string;
  paymentStatus: string;
  amountPaid: number;
  dueDate: string;
  items: InvoiceItem[];
}

export interface AccountingDispatch {
  invoice?: Invoice;
  invoices?: Invoice[];
  xml: string;
  emailDraft: string;
  message: string;
  periodYear?: number;
  periodMonth?: number;
}

export interface CertificateSettings {
  companyName: string;
  companyDocument: string;
  companyState: string;
  taxRegime: string;
  certificateYear: number;
  certificateFileName: string;
  password?: string;
  passwordConfigured: boolean;
  updatedAt: string;
}

export interface ServiceHealth {
  status: string;
  service: string;
  failureMode?: boolean;
  code?: string;
  location?: string;
  file?: string;
  path?: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly stockUrl = 'http://localhost:8081';
  private readonly billingUrl = 'http://localhost:8082';

  constructor(private readonly http: HttpClient) {}

  getProducts(): Observable<Product[]> {
    return this.http.get<Product[]>(`${this.stockUrl}/products`);
  }

  saveProduct(product: Product): Observable<Product> {
    return this.http.post<Product>(`${this.stockUrl}/products`, product);
  }

  updateProduct(product: Product): Observable<Product> {
    return this.http.put<Product>(`${this.stockUrl}/products/${encodeURIComponent(product.code)}`, product);
  }

  deleteProduct(code: string): Observable<void> {
    return this.http.delete<void>(`${this.stockUrl}/products/${encodeURIComponent(code)}`);
  }

  adjustStock(code: string, balance: number, reason: string): Observable<Product> {
    return this.http.post<Product>(`${this.stockUrl}/products/${encodeURIComponent(code)}/stock`, {
      balance,
      reason,
    });
  }

  setStockFailure(enabled: boolean): Observable<{ failureMode: boolean }> {
    return this.http.post<{ failureMode: boolean }>(`${this.stockUrl}/admin/failure`, { enabled });
  }

  getStockHealth(): Observable<ServiceHealth> {
    return this.http.get<ServiceHealth>(`${this.stockUrl}/health`);
  }

  getBillingHealth(): Observable<ServiceHealth> {
    return this.http.get<ServiceHealth>(`${this.billingUrl}/health`);
  }

  getInvoices(filters: { year?: number; month?: number; status?: string }): Observable<Invoice[]> {
    const params = new URLSearchParams();
    if (filters.year) params.set('year', String(filters.year));
    if (filters.month) params.set('month', String(filters.month));
    if (filters.status) params.set('status', filters.status);
    const query = params.toString();
    return this.http.get<Invoice[]>(`${this.billingUrl}/invoices${query ? `?${query}` : ''}`);
  }

  createInvoice(request: CreateInvoiceRequest): Observable<Invoice> {
    return this.http.post<Invoice>(`${this.billingUrl}/invoices`, request);
  }

  issueInvoice(invoiceId: number, idempotencyKey: string): Observable<Invoice> {
    return this.http.post<Invoice>(`${this.billingUrl}/invoices/${invoiceId}/print`, {
      idempotencyKey,
    });
  }

  sendAccounting(invoiceId: number, email: string): Observable<AccountingDispatch> {
    return this.http.post<AccountingDispatch>(`${this.billingUrl}/invoices/${invoiceId}/send-accounting`, {
      email,
    });
  }

  sendAccountingPeriod(email: string, year: number, month: number): Observable<AccountingDispatch> {
    return this.http.post<AccountingDispatch>(`${this.billingUrl}/accounting/dispatch`, {
      email,
      year,
      month,
    });
  }

  getCertificateSettings(): Observable<CertificateSettings> {
    return this.http.get<CertificateSettings>(`${this.billingUrl}/settings/certificate`);
  }

  saveCertificateSettings(settings: CertificateSettings): Observable<CertificateSettings> {
    return this.http.post<CertificateSettings>(`${this.billingUrl}/settings/certificate`, settings);
  }

  cancelInvoice(invoiceId: number, reason: string): Observable<Invoice> {
    return this.http.post<Invoice>(`${this.billingUrl}/invoices/${invoiceId}/cancel`, { reason });
  }

  markContingency(invoiceId: number, reason: string): Observable<Invoice> {
    return this.http.post<Invoice>(`${this.billingUrl}/invoices/${invoiceId}/contingency`, { reason });
  }

  voidInvoice(invoiceId: number, reason: string): Observable<Invoice> {
    return this.http.post<Invoice>(`${this.billingUrl}/invoices/${invoiceId}/void`, { reason });
  }

  getInvoiceXml(invoiceId: number): Observable<{ xml: string }> {
    return this.http.get<{ xml: string }>(`${this.billingUrl}/invoices/${invoiceId}/xml`);
  }
}
