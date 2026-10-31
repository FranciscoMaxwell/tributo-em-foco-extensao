package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const (
	statusOpen        = "Aberta"
	statusAuthorized  = "Autorizada"
	statusContingency = "Contingencia"
	statusSent        = "EnviadaContabilidade"
	statusCanceled    = "Cancelada"
	statusVoided      = "Inutilizada"
)

type invoice struct {
	ID               int           `json:"id"`
	Number           int           `json:"number"`
	Status           string        `json:"status"`
	CustomerName     string        `json:"customerName"`
	CustomerDocument string        `json:"customerDocument"`
	CustomerEmail    string        `json:"customerEmail"`
	CustomerState    string        `json:"customerState"`
	AccountingEmail  string        `json:"accountingEmail"`
	PaymentMethod    string        `json:"paymentMethod"`
	PaymentStatus    string        `json:"paymentStatus"`
	AmountPaid       float64       `json:"amountPaid"`
	DueDate          string        `json:"dueDate"`
	Items            []invoiceItem `json:"items"`
	IssueYear        int           `json:"issueYear"`
	IssueMonth       int           `json:"issueMonth"`
	TotalPurchase    float64       `json:"totalPurchase"`
	TotalSale        float64       `json:"totalSale"`
	TotalTax         float64       `json:"totalTax"`
	XMLContent       string        `json:"xmlContent,omitempty"`
	EmailDraft       string        `json:"emailDraft,omitempty"`
	CancelReason     string        `json:"cancelReason,omitempty"`
	CreatedAt        string        `json:"createdAt"`
	ClosedAt         *string       `json:"closedAt"`
	SentAt           *string       `json:"sentAt"`
}

type invoiceItem struct {
	ID            int     `json:"id,omitempty"`
	ProductCode   string  `json:"productCode"`
	Description   string  `json:"description"`
	NCM           string  `json:"ncm"`
	Quantity      int     `json:"quantity"`
	UnitValue     float64 `json:"unitValue"`
	PurchaseValue float64 `json:"purchaseValue"`
	TaxRate       float64 `json:"taxRate"`
	TaxValue      float64 `json:"taxValue"`
	TotalValue    float64 `json:"totalValue"`
}

type createInvoiceRequest struct {
	CustomerName     string        `json:"customerName"`
	CustomerDocument string        `json:"customerDocument"`
	CustomerEmail    string        `json:"customerEmail"`
	CustomerState    string        `json:"customerState"`
	AccountingEmail  string        `json:"accountingEmail"`
	PaymentMethod    string        `json:"paymentMethod"`
	PaymentStatus    string        `json:"paymentStatus"`
	AmountPaid       float64       `json:"amountPaid"`
	DueDate          string        `json:"dueDate"`
	Items            []invoiceItem `json:"items"`
}

type printRequest struct {
	IdempotencyKey string `json:"idempotencyKey"`
}

type sendAccountingRequest struct {
	Email string `json:"email"`
}

type cancelRequest struct {
	Reason string `json:"reason"`
}

type statusReasonRequest struct {
	Reason string `json:"reason"`
}

type accountingDispatch struct {
	Invoice     invoice   `json:"invoice,omitempty"`
	Invoices    []invoice `json:"invoices,omitempty"`
	XML         string    `json:"xml"`
	EmailDraft  string    `json:"emailDraft"`
	Message     string    `json:"message"`
	PeriodYear  int       `json:"periodYear,omitempty"`
	PeriodMonth int       `json:"periodMonth,omitempty"`
}

type certificateSettings struct {
	CompanyName         string `json:"companyName"`
	CompanyDocument     string `json:"companyDocument"`
	CompanyState        string `json:"companyState"`
	TaxRegime           string `json:"taxRegime"`
	CertificateYear     int    `json:"certificateYear"`
	CertificateFileName string `json:"certificateFileName"`
	Password            string `json:"password,omitempty"`
	PasswordConfigured  bool   `json:"passwordConfigured"`
	UpdatedAt           string `json:"updatedAt"`
}

type accountingPeriodRequest struct {
	Email string `json:"email"`
	Year  int    `json:"year"`
	Month int    `json:"month"`
}

type stockReserveRequest struct {
	InvoiceNumber  int           `json:"invoiceNumber"`
	IdempotencyKey string        `json:"idempotencyKey"`
	Items          []invoiceItem `json:"items"`
}

type apiError struct {
	Error            string `json:"error"`
	Code             string `json:"code,omitempty"`
	Phrase           string `json:"phrase,omitempty"`
	Service          string `json:"service,omitempty"`
	Location         string `json:"location,omitempty"`
	File             string `json:"file,omitempty"`
	Path             string `json:"path,omitempty"`
	Hint             string `json:"hint,omitempty"`
	UpstreamCode     string `json:"upstreamCode,omitempty"`
	UpstreamService  string `json:"upstreamService,omitempty"`
	UpstreamLocation string `json:"upstreamLocation,omitempty"`
	UpstreamFile     string `json:"upstreamFile,omitempty"`
	UpstreamPath     string `json:"upstreamPath,omitempty"`
}

type server struct {
	db           *sql.DB
	stockBaseURL string
	httpClient   *http.Client
}

func main() {
	dbPath := env("FATURAMENTO_DB", "faturamento.db")
	port := env("PORT", "8082")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()

	if err := initDatabase(db); err != nil {
		log.Fatalf("init database: %v", err)
	}

	s := &server{
		db:           db,
		stockBaseURL: strings.TrimRight(env("ESTOQUE_URL", "http://localhost:8081"), "/"),
		httpClient:   &http.Client{Timeout: 6 * time.Second},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("GET /invoices", s.listInvoices)
	mux.HandleFunc("POST /invoices", s.createInvoice)
	mux.HandleFunc("POST /invoices/{id}/print", s.issueInvoice)
	mux.HandleFunc("POST /invoices/{id}/send-accounting", s.sendAccounting)
	mux.HandleFunc("POST /invoices/{id}/cancel", s.cancelInvoice)
	mux.HandleFunc("POST /invoices/{id}/contingency", s.markContingency)
	mux.HandleFunc("POST /invoices/{id}/void", s.voidInvoice)
	mux.HandleFunc("GET /invoices/{id}/xml", s.getXML)
	mux.HandleFunc("GET /settings/certificate", s.getCertificateSettings)
	mux.HandleFunc("POST /settings/certificate", s.saveCertificateSettings)
	mux.HandleFunc("POST /accounting/dispatch", s.sendAccountingPeriod)

	log.Printf("faturamento-service listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, cors(mux)))
}

func initDatabase(db *sql.DB) error {
	_, err := db.Exec(`
CREATE TABLE IF NOT EXISTS invoices (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	status TEXT NOT NULL,
	customer_name TEXT NOT NULL DEFAULT 'Consumidor final',
	customer_document TEXT NOT NULL DEFAULT '',
	customer_email TEXT NOT NULL DEFAULT '',
	customer_state TEXT NOT NULL DEFAULT '',
	accounting_email TEXT NOT NULL DEFAULT '',
	payment_method TEXT NOT NULL DEFAULT 'Pix',
	payment_status TEXT NOT NULL DEFAULT 'Pendente',
	amount_paid REAL NOT NULL DEFAULT 0,
	due_date TEXT NOT NULL DEFAULT '',
	issue_year INTEGER NOT NULL DEFAULT 0,
	issue_month INTEGER NOT NULL DEFAULT 0,
	total_purchase REAL NOT NULL DEFAULT 0,
	total_sale REAL NOT NULL DEFAULT 0,
	total_tax REAL NOT NULL DEFAULT 0,
	xml_content TEXT NOT NULL DEFAULT '',
	email_draft TEXT NOT NULL DEFAULT '',
	cancel_reason TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	closed_at TEXT NULL,
	sent_at TEXT NULL
);

CREATE TABLE IF NOT EXISTS invoice_items (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	invoice_id INTEGER NOT NULL,
	product_code TEXT NOT NULL,
	description TEXT NOT NULL,
	ncm TEXT NOT NULL DEFAULT '',
	quantity INTEGER NOT NULL CHECK(quantity > 0),
	unit_value REAL NOT NULL DEFAULT 0,
	purchase_value REAL NOT NULL DEFAULT 0,
	tax_rate REAL NOT NULL DEFAULT 0,
	tax_value REAL NOT NULL DEFAULT 0,
	total_value REAL NOT NULL DEFAULT 0,
	FOREIGN KEY(invoice_id) REFERENCES invoices(id)
);

CREATE TABLE IF NOT EXISTS print_requests (
	idempotency_key TEXT PRIMARY KEY,
	invoice_id INTEGER NOT NULL,
	response TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS certificate_settings (
	id INTEGER PRIMARY KEY CHECK(id = 1),
	company_name TEXT NOT NULL DEFAULT '',
	company_document TEXT NOT NULL DEFAULT '',
	company_state TEXT NOT NULL DEFAULT 'CE',
	tax_regime TEXT NOT NULL DEFAULT 'Simples Nacional',
	certificate_year INTEGER NOT NULL DEFAULT 0,
	certificate_file_name TEXT NOT NULL DEFAULT '',
	password TEXT NOT NULL DEFAULT '',
	updated_at TEXT NOT NULL DEFAULT ''
);
`)
	if err != nil {
		return err
	}

	invoiceColumns := map[string]string{
		"customer_name":     "TEXT NOT NULL DEFAULT 'Consumidor final'",
		"customer_document": "TEXT NOT NULL DEFAULT ''",
		"customer_email":    "TEXT NOT NULL DEFAULT ''",
		"customer_state":    "TEXT NOT NULL DEFAULT ''",
		"accounting_email":  "TEXT NOT NULL DEFAULT ''",
		"payment_method":    "TEXT NOT NULL DEFAULT 'Pix'",
		"payment_status":    "TEXT NOT NULL DEFAULT 'Pendente'",
		"amount_paid":       "REAL NOT NULL DEFAULT 0",
		"due_date":          "TEXT NOT NULL DEFAULT ''",
		"issue_year":        "INTEGER NOT NULL DEFAULT 0",
		"issue_month":       "INTEGER NOT NULL DEFAULT 0",
		"total_purchase":    "REAL NOT NULL DEFAULT 0",
		"total_sale":        "REAL NOT NULL DEFAULT 0",
		"total_tax":         "REAL NOT NULL DEFAULT 0",
		"xml_content":       "TEXT NOT NULL DEFAULT ''",
		"email_draft":       "TEXT NOT NULL DEFAULT ''",
		"cancel_reason":     "TEXT NOT NULL DEFAULT ''",
		"sent_at":           "TEXT NULL",
	}
	for name, definition := range invoiceColumns {
		if err := ensureColumn(db, "invoices", name, definition); err != nil {
			return err
		}
	}

	itemColumns := map[string]string{
		"ncm":            "TEXT NOT NULL DEFAULT ''",
		"unit_value":     "REAL NOT NULL DEFAULT 0",
		"purchase_value": "REAL NOT NULL DEFAULT 0",
		"tax_rate":       "REAL NOT NULL DEFAULT 0",
		"tax_value":      "REAL NOT NULL DEFAULT 0",
		"total_value":    "REAL NOT NULL DEFAULT 0",
	}
	for name, definition := range itemColumns {
		if err := ensureColumn(db, "invoice_items", name, definition); err != nil {
			return err
		}
	}

	certificateColumns := map[string]string{
		"company_state": "TEXT NOT NULL DEFAULT 'CE'",
		"tax_regime":    "TEXT NOT NULL DEFAULT 'Simples Nacional'",
	}
	for name, definition := range certificateColumns {
		if err := ensureColumn(db, "certificate_settings", name, definition); err != nil {
			return err
		}
	}

	now := time.Now()
	_, _ = db.Exec(`UPDATE invoices SET status = ? WHERE status IN (?, ?)`, statusAuthorized, "Fechada", "Emitida")
	_, _ = db.Exec(`UPDATE invoices SET issue_year = ? WHERE issue_year = 0`, now.Year())
	_, _ = db.Exec(`UPDATE invoices SET issue_month = ? WHERE issue_month = 0`, int(now.Month()))
	return nil
}

func ensureColumn(db *sql.DB, table string, column string, definition string) error {
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, colType string
		var notNull, pk int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &colType, &notNull, &defaultValue, &pk); err != nil {
			return err
		}
		if name == column {
			return nil
		}
	}
	_, err = db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + column + ` ` + definition)
	return err
}

func (s *server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "ok",
		"service":  "faturamento-service",
		"code":     "NF-FAT-HEALTH",
		"location": "func (s *server) health",
		"file":     "backend/faturamento-service/main.go",
		"path":     "GET /health",
	})
}

func (s *server) listInvoices(w http.ResponseWriter, r *http.Request) {
	query := invoiceSelectSQL()
	args := []any{}
	conditions := []string{}

	if year := strings.TrimSpace(r.URL.Query().Get("year")); year != "" {
		conditions = append(conditions, "issue_year = ?")
		args = append(args, year)
	}
	if month := strings.TrimSpace(r.URL.Query().Get("month")); month != "" {
		conditions = append(conditions, "issue_month = ?")
		args = append(args, month)
	}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		conditions = append(conditions, "status = ?")
		args = append(args, status)
	}
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY id DESC"

	rows, err := s.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao listar notas")
		return
	}
	defer rows.Close()

	invoices := make([]invoice, 0)
	for rows.Next() {
		inv, err := scanInvoice(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Erro ao ler nota")
			return
		}
		items, err := s.invoiceItems(r.Context(), inv.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Erro ao listar itens")
			return
		}
		inv.Items = items
		invoices = append(invoices, inv)
	}
	writeJSON(w, http.StatusOK, invoices)
}

func (s *server) createInvoice(w http.ResponseWriter, r *http.Request) {
	var req createInvoiceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "JSON invalido")
		return
	}
	req.normalize()
	if len(req.Items) == 0 {
		writeError(w, http.StatusBadRequest, "Inclua ao menos um produto")
		return
	}
	for i := range req.Items {
		req.Items[i].normalizeTotals()
		if err := req.Items[i].validate(); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	now := time.Now().UTC()
	totals := totalsFromItems(req.Items)
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao iniciar transacao")
		return
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(
		r.Context(),
		`INSERT INTO invoices
		 (status, customer_name, customer_document, customer_email, customer_state, accounting_email, payment_method, payment_status, amount_paid, due_date, issue_year, issue_month, total_purchase, total_sale, total_tax, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		statusOpen, req.CustomerName, req.CustomerDocument, req.CustomerEmail, req.CustomerState, req.AccountingEmail,
		req.PaymentMethod, req.PaymentStatus, req.AmountPaid, req.DueDate,
		now.Year(), int(now.Month()), totals.purchase, totals.sale, totals.tax, now.Format(time.RFC3339),
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao criar nota")
		return
	}
	invoiceID, err := result.LastInsertId()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao obter numero da nota")
		return
	}

	for _, item := range req.Items {
		_, err := tx.ExecContext(
			r.Context(),
			`INSERT INTO invoice_items
			 (invoice_id, product_code, description, ncm, quantity, unit_value, purchase_value, tax_rate, tax_value, total_value)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			invoiceID, item.ProductCode, item.Description, item.NCM, item.Quantity, item.UnitValue,
			item.PurchaseValue, item.TaxRate, item.TaxValue, item.TotalValue,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Erro ao criar item da nota")
			return
		}
	}

	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao finalizar transacao")
		return
	}
	inv, err := s.getInvoice(r.Context(), int(invoiceID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao buscar nota criada")
		return
	}
	writeJSON(w, http.StatusCreated, inv)
}

func (s *server) issueInvoice(w http.ResponseWriter, r *http.Request) {
	invoiceID, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || invoiceID <= 0 {
		writeError(w, http.StatusBadRequest, "Nota invalida")
		return
	}

	var req printRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "JSON invalido")
		return
	}
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	if req.IdempotencyKey == "" {
		writeError(w, http.StatusBadRequest, "Chave de idempotencia obrigatoria")
		return
	}

	if cached, ok, err := s.cachedPrint(r.Context(), req.IdempotencyKey); err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao verificar idempotencia")
		return
	} else if ok {
		writeRawJSON(w, http.StatusOK, cached)
		return
	}

	inv, err := s.getInvoice(r.Context(), invoiceID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "Nota nao encontrada")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao buscar nota")
		return
	}
	if inv.Status != statusOpen {
		writeError(w, http.StatusConflict, "Somente notas com status Aberta podem ser emitidas")
		return
	}

	stockIdempotencyKey := fmt.Sprintf("invoice-issue-%d", inv.ID)
	if apiErr := s.reserveStock(r.Context(), inv, stockIdempotencyKey); apiErr != nil {
		writeAPIError(w, http.StatusServiceUnavailable, *apiErr)
		return
	}

	xmlContent := generateXML(inv)
	closedAt := time.Now().UTC().Format(time.RFC3339)
	_, err = s.db.ExecContext(
		r.Context(),
		`UPDATE invoices SET status = ?, closed_at = ?, xml_content = ? WHERE id = ? AND status = ?`,
		statusAuthorized, closedAt, xmlContent, invoiceID, statusOpen,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Estoque reservado, mas houve erro ao emitir a nota")
		return
	}

	inv, err = s.getInvoice(r.Context(), invoiceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Nota emitida, mas houve erro ao recarregar")
		return
	}
	response, _ := json.Marshal(inv)
	_, _ = s.db.ExecContext(r.Context(), `INSERT INTO print_requests (idempotency_key, invoice_id, response) VALUES (?, ?, ?)`, req.IdempotencyKey, invoiceID, string(response))
	writeJSON(w, http.StatusOK, inv)
}

func (s *server) sendAccounting(w http.ResponseWriter, r *http.Request) {
	invoiceID, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || invoiceID <= 0 {
		writeError(w, http.StatusBadRequest, "Nota invalida")
		return
	}

	var req sendAccountingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "JSON invalido")
		return
	}
	req.Email = strings.TrimSpace(req.Email)
	if req.Email == "" {
		writeError(w, http.StatusBadRequest, "Email da contabilidade e obrigatorio")
		return
	}

	inv, err := s.getInvoice(r.Context(), invoiceID)
	if err != nil {
		writeError(w, http.StatusNotFound, "Nota nao encontrada")
		return
	}
	if inv.Status != statusAuthorized && inv.Status != statusContingency && inv.Status != statusSent {
		writeError(w, http.StatusConflict, "Somente notas Autorizadas ou em Contingencia podem ser enviadas para contabilidade")
		return
	}

	xmlContent := inv.XMLContent
	if xmlContent == "" {
		xmlContent = generateXML(inv)
	}
	emailDraft := generateEmailDraft(inv, req.Email, xmlContent)
	sentAt := time.Now().UTC().Format(time.RFC3339)
	_, err = s.db.ExecContext(
		r.Context(),
		`UPDATE invoices SET status = ?, accounting_email = ?, xml_content = ?, email_draft = ?, sent_at = ? WHERE id = ?`,
		statusSent, req.Email, xmlContent, emailDraft, sentAt, invoiceID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao registrar remessa contabil")
		return
	}
	inv, _ = s.getInvoice(r.Context(), invoiceID)
	writeJSON(w, http.StatusOK, accountingDispatch{
		Invoice:    inv,
		XML:        xmlContent,
		EmailDraft: emailDraft,
		Message:    "Remessa contabil local gerada. Sem SMTP externo, o sistema registra o envio e disponibiliza XML/rascunho.",
	})
}

func (s *server) sendAccountingPeriod(w http.ResponseWriter, r *http.Request) {
	var req accountingPeriodRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "JSON invalido")
		return
	}
	req.Email = strings.TrimSpace(req.Email)
	if req.Email == "" {
		writeError(w, http.StatusBadRequest, "Email da contabilidade e obrigatorio")
		return
	}
	if req.Year <= 0 {
		req.Year = time.Now().Year()
	}

	query := invoiceSelectSQL() + ` WHERE issue_year = ? AND status IN (?, ?, ?)`
	args := []any{req.Year, statusAuthorized, statusContingency, statusSent}
	if req.Month > 0 {
		query += ` AND issue_month = ?`
		args = append(args, req.Month)
	}
	query += ` ORDER BY id`

	rows, err := s.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao buscar notas do periodo")
		return
	}
	defer rows.Close()

	invoices := make([]invoice, 0)
	for rows.Next() {
		inv, err := scanInvoice(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Erro ao ler nota do periodo")
			return
		}
		items, err := s.invoiceItems(r.Context(), inv.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Erro ao ler itens do periodo")
			return
		}
		inv.Items = items
		invoices = append(invoices, inv)
	}
	if len(invoices) == 0 {
		writeError(w, http.StatusNotFound, "Nenhuma NF autorizada/contingencia encontrada para o periodo")
		return
	}

	var xmls strings.Builder
	xmls.WriteString(xml.Header)
	xmls.WriteString(fmt.Sprintf(`<RemessaContabil ano="%d" mes="%d">`, req.Year, req.Month))
	for _, inv := range invoices {
		xmlContent := inv.XMLContent
		if xmlContent == "" {
			xmlContent = generateXML(inv)
		}
		xmls.WriteString(`<Documento>`)
		xmls.WriteString(strings.TrimPrefix(xmlContent, xml.Header))
		xmls.WriteString(`</Documento>`)
	}
	xmls.WriteString(`</RemessaContabil>`)

	emailDraft := fmt.Sprintf("To: %s\nSubject: Remessa contabil NF-e %d/%02d\nAttachment: remessa-contabil-%d-%02d.xml\n\nSegue remessa local com %d NF(s) do periodo solicitado.", req.Email, req.Year, req.Month, req.Year, req.Month, len(invoices))
	now := time.Now().UTC().Format(time.RFC3339)
	for _, inv := range invoices {
		_, _ = s.db.ExecContext(r.Context(), `UPDATE invoices SET status = ?, accounting_email = ?, sent_at = ?, email_draft = ? WHERE id = ?`, statusSent, req.Email, now, emailDraft, inv.ID)
	}

	writeJSON(w, http.StatusOK, accountingDispatch{
		Invoices:    invoices,
		XML:         xmls.String(),
		EmailDraft:  emailDraft,
		Message:     fmt.Sprintf("Remessa contabil local gerada com %d NF(s).", len(invoices)),
		PeriodYear:  req.Year,
		PeriodMonth: req.Month,
	})
}

func (s *server) getCertificateSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.loadCertificateSettings(r.Context())
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "Erro ao carregar certificado")
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *server) saveCertificateSettings(w http.ResponseWriter, r *http.Request) {
	var settings certificateSettings
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		writeError(w, http.StatusBadRequest, "JSON invalido")
		return
	}
	settings.CompanyName = strings.TrimSpace(settings.CompanyName)
	settings.CompanyDocument = strings.TrimSpace(settings.CompanyDocument)
	settings.CompanyState = strings.ToUpper(strings.TrimSpace(settings.CompanyState))
	settings.TaxRegime = strings.TrimSpace(settings.TaxRegime)
	settings.CertificateFileName = strings.TrimSpace(settings.CertificateFileName)
	settings.Password = strings.TrimSpace(settings.Password)
	if settings.CompanyState == "" {
		settings.CompanyState = "CE"
	}
	if settings.TaxRegime == "" {
		settings.TaxRegime = "Simples Nacional"
	}
	if settings.CertificateYear <= 0 {
		settings.CertificateYear = time.Now().Year()
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.ExecContext(
		r.Context(),
		`INSERT INTO certificate_settings (id, company_name, company_document, company_state, tax_regime, certificate_year, certificate_file_name, password, updated_at)
		 VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		 company_name = excluded.company_name,
		 company_document = excluded.company_document,
		 company_state = excluded.company_state,
		 tax_regime = excluded.tax_regime,
		 certificate_year = excluded.certificate_year,
		 certificate_file_name = excluded.certificate_file_name,
		 password = excluded.password,
		 updated_at = excluded.updated_at`,
		settings.CompanyName, settings.CompanyDocument, settings.CompanyState, settings.TaxRegime, settings.CertificateYear, settings.CertificateFileName, settings.Password, now,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao salvar certificado")
		return
	}
	saved, _ := s.loadCertificateSettings(r.Context())
	writeJSON(w, http.StatusOK, saved)
}

func (s *server) cancelInvoice(w http.ResponseWriter, r *http.Request) {
	invoiceID, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || invoiceID <= 0 {
		writeError(w, http.StatusBadRequest, "Nota invalida")
		return
	}
	var req cancelRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	req.Reason = strings.TrimSpace(req.Reason)
	if req.Reason == "" {
		req.Reason = "Cancelamento administrativo"
	}
	inv, err := s.getInvoice(r.Context(), invoiceID)
	if err != nil {
		writeError(w, http.StatusNotFound, "Nota nao encontrada")
		return
	}
	if inv.Status == statusSent {
		writeError(w, http.StatusConflict, "Nota enviada para contabilidade nao pode ser cancelada neste fluxo local")
		return
	}
	if inv.Status == statusCanceled {
		writeError(w, http.StatusConflict, "Nota ja esta cancelada")
		return
	}
	if inv.Status == statusVoided {
		writeError(w, http.StatusConflict, "Nota inutilizada nao pode ser cancelada")
		return
	}
	_, err = s.db.ExecContext(r.Context(), `UPDATE invoices SET status = ?, cancel_reason = ? WHERE id = ?`, statusCanceled, req.Reason, invoiceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao cancelar nota")
		return
	}
	inv, _ = s.getInvoice(r.Context(), invoiceID)
	writeJSON(w, http.StatusOK, inv)
}

func (s *server) markContingency(w http.ResponseWriter, r *http.Request) {
	invoiceID, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || invoiceID <= 0 {
		writeError(w, http.StatusBadRequest, "Nota invalida")
		return
	}
	var req statusReasonRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	req.Reason = strings.TrimSpace(req.Reason)
	if req.Reason == "" {
		req.Reason = "Emissao em contingencia por indisponibilidade operacional"
	}
	inv, err := s.getInvoice(r.Context(), invoiceID)
	if err != nil {
		writeError(w, http.StatusNotFound, "Nota nao encontrada")
		return
	}
	if inv.Status != statusOpen && inv.Status != statusAuthorized {
		writeError(w, http.StatusConflict, "Somente notas Abertas ou Autorizadas podem ir para Contingencia")
		return
	}
	xmlContent := inv.XMLContent
	if xmlContent == "" {
		xmlContent = generateXML(inv)
	}
	_, err = s.db.ExecContext(r.Context(), `UPDATE invoices SET status = ?, xml_content = ?, cancel_reason = ? WHERE id = ?`, statusContingency, xmlContent, req.Reason, invoiceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao marcar contingencia")
		return
	}
	inv, _ = s.getInvoice(r.Context(), invoiceID)
	writeJSON(w, http.StatusOK, inv)
}

func (s *server) voidInvoice(w http.ResponseWriter, r *http.Request) {
	invoiceID, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || invoiceID <= 0 {
		writeError(w, http.StatusBadRequest, "Nota invalida")
		return
	}
	var req statusReasonRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	req.Reason = strings.TrimSpace(req.Reason)
	if req.Reason == "" {
		req.Reason = "Inutilizacao administrativa da numeracao"
	}
	inv, err := s.getInvoice(r.Context(), invoiceID)
	if err != nil {
		writeError(w, http.StatusNotFound, "Nota nao encontrada")
		return
	}
	if inv.Status != statusOpen && inv.Status != statusCanceled {
		writeError(w, http.StatusConflict, "Somente notas Abertas ou Canceladas podem ser inutilizadas neste fluxo local")
		return
	}
	_, err = s.db.ExecContext(r.Context(), `UPDATE invoices SET status = ?, cancel_reason = ? WHERE id = ?`, statusVoided, req.Reason, invoiceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao inutilizar nota")
		return
	}
	inv, _ = s.getInvoice(r.Context(), invoiceID)
	writeJSON(w, http.StatusOK, inv)
}

func (s *server) getXML(w http.ResponseWriter, r *http.Request) {
	invoiceID, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || invoiceID <= 0 {
		writeError(w, http.StatusBadRequest, "Nota invalida")
		return
	}
	inv, err := s.getInvoice(r.Context(), invoiceID)
	if err != nil {
		writeError(w, http.StatusNotFound, "Nota nao encontrada")
		return
	}
	xmlContent := inv.XMLContent
	if xmlContent == "" {
		xmlContent = generateXML(inv)
	}
	writeJSON(w, http.StatusOK, map[string]string{"xml": xmlContent})
}

func (s *server) reserveStock(ctx context.Context, inv invoice, idempotencyKey string) *apiError {
	payload := stockReserveRequest{InvoiceNumber: inv.Number, IdempotencyKey: idempotencyKey, Items: inv.Items}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.stockBaseURL+"/stock/reserve", bytes.NewReader(body))
	if err != nil {
		return billingAPIError("NF-FAT-001", "Erro ao montar chamada HTTP para o estoque", "Nao foi possivel criar a requisicao interna.", nil)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", idempotencyKey)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return billingAPIError("NF-FAT-002", "Falha de comunicacao com o estoque", fmt.Sprintf("Falha ao comunicar com o estoque: %v", err), nil)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}

	payloadBytes, _ := io.ReadAll(resp.Body)
	var stockErr apiError
	if err := json.Unmarshal(payloadBytes, &stockErr); err == nil && stockErr.Error != "" {
		return billingAPIError("NF-FAT-003", "Emissao bloqueada pelo estoque", stockErr.Error, &stockErr)
	}
	return billingAPIError("NF-FAT-004", "Estoque retornou erro inesperado", fmt.Sprintf("Estoque retornou erro HTTP %d", resp.StatusCode), nil)
}

func billingAPIError(code string, phrase string, message string, upstream *apiError) *apiError {
	err := &apiError{
		Error:    fmt.Sprintf("%s - %s", code, message),
		Code:     code,
		Phrase:   phrase,
		Service:  "faturamento-service",
		Location: "func (s *server) issueInvoice -> reserveStock",
		File:     "backend/faturamento-service/main.go",
		Path:     "POST /invoices/{id}/print",
		Hint:     "A NF permanece Aberta. Corrija a causa e clique em Emitir novamente.",
	}
	if upstream != nil {
		err.UpstreamCode = upstream.Code
		err.UpstreamService = upstream.Service
		err.UpstreamLocation = upstream.Location
		err.UpstreamFile = upstream.File
		err.UpstreamPath = upstream.Path
		if upstream.Hint != "" {
			err.Hint = upstream.Hint
		}
	}
	return err
}

func (s *server) getInvoice(ctx context.Context, id int) (invoice, error) {
	inv, err := scanInvoice(s.db.QueryRowContext(ctx, invoiceSelectSQL()+` WHERE id = ?`, id))
	if err != nil {
		return invoice{}, err
	}
	items, err := s.invoiceItems(ctx, id)
	if err != nil {
		return invoice{}, err
	}
	inv.Items = items
	return inv, nil
}

func (s *server) loadCertificateSettings(ctx context.Context) (certificateSettings, error) {
	var settings certificateSettings
	var password string
	err := s.db.QueryRowContext(ctx, `SELECT company_name, company_document, company_state, tax_regime, certificate_year, certificate_file_name, password, updated_at FROM certificate_settings WHERE id = 1`).
		Scan(&settings.CompanyName, &settings.CompanyDocument, &settings.CompanyState, &settings.TaxRegime, &settings.CertificateYear, &settings.CertificateFileName, &password, &settings.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		settings.CertificateYear = time.Now().Year()
		settings.CompanyState = "CE"
		settings.TaxRegime = "Simples Nacional"
		return settings, nil
	}
	if settings.CompanyState == "" {
		settings.CompanyState = "CE"
	}
	if settings.TaxRegime == "" {
		settings.TaxRegime = "Simples Nacional"
	}
	settings.PasswordConfigured = password != ""
	return settings, err
}

func (s *server) invoiceItems(ctx context.Context, invoiceID int) ([]invoiceItem, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, product_code, description, ncm, quantity, unit_value, purchase_value, tax_rate, tax_value, total_value FROM invoice_items WHERE invoice_id = ? ORDER BY id`, invoiceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]invoiceItem, 0)
	for rows.Next() {
		var item invoiceItem
		if err := rows.Scan(&item.ID, &item.ProductCode, &item.Description, &item.NCM, &item.Quantity, &item.UnitValue, &item.PurchaseValue, &item.TaxRate, &item.TaxValue, &item.TotalValue); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *server) cachedPrint(ctx context.Context, idempotencyKey string) ([]byte, bool, error) {
	var response string
	err := s.db.QueryRowContext(ctx, `SELECT response FROM print_requests WHERE idempotency_key = ?`, idempotencyKey).Scan(&response)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return []byte(response), true, nil
}

type scanner interface {
	Scan(dest ...any) error
}

func invoiceSelectSQL() string {
	return `SELECT id, status, customer_name, customer_document, customer_email, customer_state, accounting_email, payment_method, payment_status, amount_paid, due_date, issue_year, issue_month, total_purchase, total_sale, total_tax, xml_content, email_draft, cancel_reason, created_at, closed_at, sent_at FROM invoices`
}

func scanInvoice(row scanner) (invoice, error) {
	var inv invoice
	var closedAt, sentAt sql.NullString
	err := row.Scan(&inv.ID, &inv.Status, &inv.CustomerName, &inv.CustomerDocument, &inv.CustomerEmail, &inv.CustomerState, &inv.AccountingEmail, &inv.PaymentMethod, &inv.PaymentStatus, &inv.AmountPaid, &inv.DueDate, &inv.IssueYear, &inv.IssueMonth, &inv.TotalPurchase, &inv.TotalSale, &inv.TotalTax, &inv.XMLContent, &inv.EmailDraft, &inv.CancelReason, &inv.CreatedAt, &closedAt, &sentAt)
	inv.Number = inv.ID
	if closedAt.Valid {
		inv.ClosedAt = &closedAt.String
	}
	if sentAt.Valid {
		inv.SentAt = &sentAt.String
	}
	return inv, err
}

type totals struct {
	purchase float64
	sale     float64
	tax      float64
}

func totalsFromItems(items []invoiceItem) totals {
	var t totals
	for _, item := range items {
		t.purchase += item.PurchaseValue * float64(item.Quantity)
		t.sale += item.TotalValue
		t.tax += item.TaxValue
	}
	return t
}

func (req *createInvoiceRequest) normalize() {
	req.CustomerName = strings.TrimSpace(req.CustomerName)
	req.CustomerDocument = strings.TrimSpace(req.CustomerDocument)
	req.CustomerEmail = strings.TrimSpace(req.CustomerEmail)
	req.CustomerState = strings.ToUpper(strings.TrimSpace(req.CustomerState))
	req.AccountingEmail = strings.TrimSpace(req.AccountingEmail)
	if req.CustomerName == "" {
		req.CustomerName = "Consumidor final"
	}
	if strings.TrimSpace(req.PaymentMethod) == "" {
		req.PaymentMethod = "Pix"
	}
	if strings.TrimSpace(req.PaymentStatus) == "" {
		req.PaymentStatus = "Pendente"
	}
	req.PaymentMethod = strings.TrimSpace(req.PaymentMethod)
	req.PaymentStatus = strings.TrimSpace(req.PaymentStatus)
	req.DueDate = strings.TrimSpace(req.DueDate)
	if req.AmountPaid < 0 {
		req.AmountPaid = 0
	}
}

func (item *invoiceItem) normalizeTotals() {
	item.ProductCode = strings.TrimSpace(item.ProductCode)
	item.Description = strings.TrimSpace(item.Description)
	item.NCM = strings.TrimSpace(item.NCM)
	item.TaxValue = round2(item.UnitValue * float64(item.Quantity) * item.TaxRate / 100)
	item.TotalValue = round2(item.UnitValue * float64(item.Quantity))
}

func (item invoiceItem) validate() error {
	if item.ProductCode == "" || item.Description == "" {
		return errors.New("Produto e descricao sao obrigatorios")
	}
	if item.Quantity <= 0 {
		return errors.New("Quantidade deve ser maior que zero")
	}
	if item.UnitValue < 0 || item.PurchaseValue < 0 || item.TaxRate < 0 {
		return errors.New("Valores e tributacao nao podem ser negativos")
	}
	return nil
}

func generateXML(inv invoice) string {
	var b strings.Builder
	b.WriteString(xml.Header)
	b.WriteString(fmt.Sprintf(`<NFe numero="%d" status="%s" ano="%d" mes="%d">`, inv.Number, esc(inv.Status), inv.IssueYear, inv.IssueMonth))
	b.WriteString(`<destinatario>`)
	b.WriteString(`<nome>` + esc(inv.CustomerName) + `</nome>`)
	b.WriteString(`<documento>` + esc(inv.CustomerDocument) + `</documento>`)
	b.WriteString(`<email>` + esc(inv.CustomerEmail) + `</email>`)
	b.WriteString(`<uf>` + esc(inv.CustomerState) + `</uf>`)
	b.WriteString(`</destinatario>`)
	b.WriteString(`<pagamento>`)
	b.WriteString(`<forma>` + esc(inv.PaymentMethod) + `</forma>`)
	b.WriteString(`<status>` + esc(inv.PaymentStatus) + `</status>`)
	b.WriteString(fmt.Sprintf(`<valorPago>%.2f</valorPago>`, inv.AmountPaid))
	b.WriteString(`<vencimento>` + esc(inv.DueDate) + `</vencimento>`)
	b.WriteString(`</pagamento>`)
	b.WriteString(`<itens>`)
	for _, item := range inv.Items {
		b.WriteString(`<item>`)
		b.WriteString(`<codigo>` + esc(item.ProductCode) + `</codigo>`)
		b.WriteString(`<descricao>` + esc(item.Description) + `</descricao>`)
		b.WriteString(`<ncm>` + esc(item.NCM) + `</ncm>`)
		b.WriteString(fmt.Sprintf(`<quantidade>%d</quantidade>`, item.Quantity))
		b.WriteString(fmt.Sprintf(`<valorUnitario>%.2f</valorUnitario>`, item.UnitValue))
		b.WriteString(fmt.Sprintf(`<aliquota>%.2f</aliquota>`, item.TaxRate))
		b.WriteString(fmt.Sprintf(`<tributo>%.2f</tributo>`, item.TaxValue))
		b.WriteString(fmt.Sprintf(`<total>%.2f</total>`, item.TotalValue))
		b.WriteString(`</item>`)
	}
	b.WriteString(`</itens>`)
	b.WriteString(fmt.Sprintf(`<totais><valorProdutos>%.2f</valorProdutos><valorTributos>%.2f</valorTributos></totais>`, inv.TotalSale, inv.TotalTax))
	b.WriteString(`</NFe>`)
	return b.String()
}

func generateEmailDraft(inv invoice, email string, xmlContent string) string {
	return fmt.Sprintf("To: %s\nSubject: XML NF #%d\nAttachment: NF-%d.xml\n\nSegue XML da NF #%d para conferencia contabil.\n\n%s", email, inv.Number, inv.Number, inv.Number, xmlContent)
}

func esc(value string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(value))
	return b.String()
}

func round2(value float64) float64 {
	return float64(int(value*100+0.5)) / 100
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeRawJSON(w http.ResponseWriter, status int, value []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeAPIError(w http.ResponseWriter, status int, err apiError) {
	writeJSON(w, status, err)
}

func env(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}
