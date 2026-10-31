package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type product struct {
	Code                 string  `json:"code"`
	Description          string  `json:"description"`
	PackagingDescription string  `json:"packagingDescription"`
	PhotoDataURL         string  `json:"photoDataUrl"`
	NCM                  string  `json:"ncm"`
	Unit                 string  `json:"unit"`
	Balance              int     `json:"balance"`
	PurchasePrice        float64 `json:"purchasePrice"`
	SalePrice            float64 `json:"salePrice"`
	TaxRate              float64 `json:"taxRate"`
	TaxProfile           string  `json:"taxProfile"`
	CFOP                 string  `json:"cfop"`
	CSOSN                string  `json:"csosn"`
	ProductType          string  `json:"productType"`
	Origin               string  `json:"origin"`
	Active               bool    `json:"active"`
	CreatedAt            string  `json:"createdAt,omitempty"`
	UpdatedAt            string  `json:"updatedAt,omitempty"`
}

type reserveRequest struct {
	InvoiceNumber  int           `json:"invoiceNumber"`
	IdempotencyKey string        `json:"idempotencyKey"`
	Items          []reserveItem `json:"items"`
}

type reserveItem struct {
	ProductCode string `json:"productCode"`
	Quantity    int    `json:"quantity"`
}

type reserveResponse struct {
	Reserved  bool   `json:"reserved"`
	Duplicate bool   `json:"duplicate"`
	Message   string `json:"message"`
}

type stockAdjustRequest struct {
	Balance int    `json:"balance"`
	Reason  string `json:"reason"`
}

type failureRequest struct {
	Enabled bool `json:"enabled"`
}

type apiError struct {
	Error    string `json:"error"`
	Code     string `json:"code,omitempty"`
	Phrase   string `json:"phrase,omitempty"`
	Service  string `json:"service,omitempty"`
	Location string `json:"location,omitempty"`
	File     string `json:"file,omitempty"`
	Path     string `json:"path,omitempty"`
	Hint     string `json:"hint,omitempty"`
}

type server struct {
	db          *sql.DB
	failureLock sync.RWMutex
	failureMode bool
}

func main() {
	dbPath := env("ESTOQUE_DB", "estoque.db")
	port := env("PORT", "8081")

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()

	if err := initDatabase(db); err != nil {
		log.Fatalf("init database: %v", err)
	}

	s := &server{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("GET /products", s.listProducts)
	mux.HandleFunc("POST /products", s.saveProduct)
	mux.HandleFunc("GET /products/{code}", s.getProduct)
	mux.HandleFunc("PUT /products/{code}", s.updateProduct)
	mux.HandleFunc("DELETE /products/{code}", s.deleteProduct)
	mux.HandleFunc("POST /products/{code}/stock", s.adjustStock)
	mux.HandleFunc("POST /stock/reserve", s.reserveStock)
	mux.HandleFunc("POST /admin/failure", s.setFailureMode)

	log.Printf("estoque-service listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, cors(mux)))
}

func initDatabase(db *sql.DB) error {
	_, err := db.Exec(`
CREATE TABLE IF NOT EXISTS products (
	code TEXT PRIMARY KEY,
	description TEXT NOT NULL,
	packaging_description TEXT NOT NULL DEFAULT '',
	photo_data_url TEXT NOT NULL DEFAULT '',
	ncm TEXT NOT NULL DEFAULT '',
	unit TEXT NOT NULL DEFAULT 'UN',
	balance INTEGER NOT NULL CHECK(balance >= 0),
	purchase_price REAL NOT NULL DEFAULT 0,
	sale_price REAL NOT NULL DEFAULT 0,
	tax_rate REAL NOT NULL DEFAULT 0,
	tax_profile TEXT NOT NULL DEFAULT '',
	cfop TEXT NOT NULL DEFAULT '5102',
	csosn TEXT NOT NULL DEFAULT '102',
	product_type TEXT NOT NULL DEFAULT '',
	origin TEXT NOT NULL DEFAULT 'Nacional',
	active INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_reservations (
	idempotency_key TEXT PRIMARY KEY,
	invoice_number INTEGER NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`)
	if err != nil {
		return err
	}

	columns := map[string]string{
		"packaging_description": "TEXT NOT NULL DEFAULT ''",
		"photo_data_url":         "TEXT NOT NULL DEFAULT ''",
		"ncm":                   "TEXT NOT NULL DEFAULT ''",
		"unit":                  "TEXT NOT NULL DEFAULT 'UN'",
		"purchase_price":        "REAL NOT NULL DEFAULT 0",
		"sale_price":            "REAL NOT NULL DEFAULT 0",
		"tax_rate":              "REAL NOT NULL DEFAULT 0",
		"tax_profile":           "TEXT NOT NULL DEFAULT ''",
		"cfop":                  "TEXT NOT NULL DEFAULT '5102'",
		"csosn":                 "TEXT NOT NULL DEFAULT '102'",
		"product_type":          "TEXT NOT NULL DEFAULT ''",
		"origin":                "TEXT NOT NULL DEFAULT 'Nacional'",
		"active":                "INTEGER NOT NULL DEFAULT 1",
		"updated_at":            "TEXT NOT NULL DEFAULT ''",
	}
	for name, definition := range columns {
		if err := ensureColumn(db, "products", name, definition); err != nil {
			return err
		}
	}
	_, _ = db.Exec(`UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE updated_at = ''`)
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
	failureMode := s.isFailureMode()
	status := "ok"
	if failureMode {
		status = "degraded"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      status,
		"service":     "estoque-service",
		"failureMode": failureMode,
		"code":        "NF-EST-HEALTH",
		"location":    "func (s *server) health",
		"file":        "backend/estoque-service/main.go",
		"path":        "GET /health",
	})
}

func (s *server) listProducts(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.QueryContext(r.Context(), productSelectSQL()+` ORDER BY description`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao listar produtos")
		return
	}
	defer rows.Close()

	products := make([]product, 0)
	for rows.Next() {
		p, err := scanProduct(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Erro ao ler produto")
			return
		}
		products = append(products, p)
	}

	writeJSON(w, http.StatusOK, products)
}

func (s *server) saveProduct(w http.ResponseWriter, r *http.Request) {
	var p product
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeError(w, http.StatusBadRequest, "JSON invalido")
		return
	}

	p.normalize()
	if err := p.validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.ExecContext(
		r.Context(),
		`INSERT INTO products
		 (code, description, packaging_description, photo_data_url, ncm, unit, balance, purchase_price, sale_price, tax_rate, tax_profile, cfop, csosn, product_type, origin, active, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(code) DO UPDATE SET
		 description = excluded.description,
		 packaging_description = excluded.packaging_description,
		 photo_data_url = excluded.photo_data_url,
		 ncm = excluded.ncm,
		 unit = excluded.unit,
		 balance = excluded.balance,
		 purchase_price = excluded.purchase_price,
		 sale_price = excluded.sale_price,
		 tax_rate = excluded.tax_rate,
		 tax_profile = excluded.tax_profile,
		 cfop = excluded.cfop,
		 csosn = excluded.csosn,
		 product_type = excluded.product_type,
		 origin = excluded.origin,
		 active = excluded.active,
		 updated_at = excluded.updated_at`,
		p.Code, p.Description, p.PackagingDescription, p.PhotoDataURL, p.NCM, p.Unit, p.Balance, p.PurchasePrice, p.SalePrice,
		p.TaxRate, p.TaxProfile, p.CFOP, p.CSOSN, p.ProductType, p.Origin, boolToInt(p.Active), now, now,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao salvar produto")
		return
	}

	saved, err := s.productByCode(r.Context(), p.Code)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Produto salvo, mas houve erro ao recarregar")
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (s *server) updateProduct(w http.ResponseWriter, r *http.Request) {
	var p product
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeError(w, http.StatusBadRequest, "JSON invalido")
		return
	}
	p.Code = r.PathValue("code")
	s.saveProductWithPayload(w, r, p)
}

func (s *server) saveProductWithPayload(w http.ResponseWriter, r *http.Request, p product) {
	p.normalize()
	if err := p.validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	result, err := s.db.ExecContext(
		r.Context(),
		`UPDATE products SET description = ?, packaging_description = ?, photo_data_url = ?, ncm = ?, unit = ?, balance = ?, purchase_price = ?,
		 sale_price = ?, tax_rate = ?, tax_profile = ?, cfop = ?, csosn = ?, product_type = ?, origin = ?, active = ?, updated_at = ?
		 WHERE code = ?`,
		p.Description, p.PackagingDescription, p.PhotoDataURL, p.NCM, p.Unit, p.Balance, p.PurchasePrice, p.SalePrice, p.TaxRate,
		p.TaxProfile, p.CFOP, p.CSOSN, p.ProductType, p.Origin, boolToInt(p.Active), now, p.Code,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao atualizar produto")
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		writeError(w, http.StatusNotFound, "Produto nao encontrado")
		return
	}
	saved, _ := s.productByCode(r.Context(), p.Code)
	writeJSON(w, http.StatusOK, saved)
}

func (s *server) getProduct(w http.ResponseWriter, r *http.Request) {
	p, err := s.productByCode(r.Context(), r.PathValue("code"))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "Produto nao encontrado")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao buscar produto")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *server) deleteProduct(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.PathValue("code"))
	result, err := s.db.ExecContext(r.Context(), `DELETE FROM products WHERE code = ?`, code)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao excluir produto")
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		writeError(w, http.StatusNotFound, "Produto nao encontrado")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) adjustStock(w http.ResponseWriter, r *http.Request) {
	var req stockAdjustRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "JSON invalido")
		return
	}
	if req.Balance < 0 {
		writeError(w, http.StatusBadRequest, "Saldo nao pode ser negativo")
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	result, err := s.db.ExecContext(r.Context(), `UPDATE products SET balance = ?, updated_at = ? WHERE code = ?`, req.Balance, now, r.PathValue("code"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao ajustar estoque")
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		writeError(w, http.StatusNotFound, "Produto nao encontrado")
		return
	}
	p, _ := s.productByCode(r.Context(), r.PathValue("code"))
	writeJSON(w, http.StatusOK, p)
}

func (s *server) reserveStock(w http.ResponseWriter, r *http.Request) {
	if s.isFailureMode() {
		writeAPIError(w, http.StatusServiceUnavailable, apiError{
			Error:    "NF-EST-001 - Estoque indisponivel por falha simulada",
			Code:     "NF-EST-001",
			Phrase:   "Falha simulada no microsservico de estoque",
			Service:  "estoque-service",
			Location: "func (s *server) reserveStock",
			File:     "backend/estoque-service/main.go",
			Path:     "POST /stock/reserve",
			Hint:     "Desative a falha simulada no botao Restaurar e tente emitir a NF novamente.",
		})
		return
	}

	var req reserveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "JSON invalido")
		return
	}

	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	if req.InvoiceNumber <= 0 || req.IdempotencyKey == "" || len(req.Items) == 0 {
		writeError(w, http.StatusBadRequest, "Nota, chave de idempotencia e itens sao obrigatorios")
		return
	}

	aggregated := map[string]int{}
	for _, item := range req.Items {
		code := strings.TrimSpace(item.ProductCode)
		if code == "" || item.Quantity <= 0 {
			writeError(w, http.StatusBadRequest, "Produto e quantidade positiva sao obrigatorios")
			return
		}
		aggregated[code] += item.Quantity
	}

	tx, err := s.db.BeginTx(r.Context(), &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao iniciar transacao")
		return
	}
	defer tx.Rollback()

	var existing int
	err = tx.QueryRowContext(r.Context(), `SELECT COUNT(1) FROM stock_reservations WHERE idempotency_key = ?`, req.IdempotencyKey).Scan(&existing)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao verificar idempotencia")
		return
	}
	if existing > 0 {
		if err := tx.Commit(); err != nil {
			writeError(w, http.StatusInternalServerError, "Erro ao finalizar transacao")
			return
		}
		writeJSON(w, http.StatusOK, reserveResponse{Reserved: true, Duplicate: true, Message: "Reserva ja processada anteriormente"})
		return
	}

	for code, quantity := range aggregated {
		result, err := tx.ExecContext(r.Context(), `UPDATE products SET balance = balance - ?, updated_at = ? WHERE code = ? AND balance >= ?`, quantity, time.Now().UTC().Format(time.RFC3339), code, quantity)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Erro ao atualizar saldo")
			return
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			message := s.stockProblemMessage(r.Context(), tx, code, quantity)
			writeError(w, http.StatusConflict, message)
			return
		}
	}

	_, err = tx.ExecContext(r.Context(), `INSERT INTO stock_reservations (idempotency_key, invoice_number) VALUES (?, ?)`, req.IdempotencyKey, req.InvoiceNumber)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao registrar reserva")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "Erro ao finalizar transacao")
		return
	}
	writeJSON(w, http.StatusOK, reserveResponse{Reserved: true, Message: "Saldo reservado com sucesso"})
}

func (s *server) stockProblemMessage(ctx context.Context, tx *sql.Tx, code string, quantity int) string {
	var balance int
	err := tx.QueryRowContext(ctx, `SELECT balance FROM products WHERE code = ?`, code).Scan(&balance)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Sprintf("Produto %s nao encontrado", code)
	}
	if err != nil {
		return "Saldo indisponivel"
	}
	return fmt.Sprintf("Saldo insuficiente para o produto %s. Disponivel: %d, solicitado: %d", code, balance, quantity)
}

func (s *server) setFailureMode(w http.ResponseWriter, r *http.Request) {
	var req failureRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "JSON invalido")
		return
	}
	s.failureLock.Lock()
	s.failureMode = req.Enabled
	s.failureLock.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"failureMode": req.Enabled})
}

func (s *server) productByCode(ctx context.Context, code string) (product, error) {
	row := s.db.QueryRowContext(ctx, productSelectSQL()+` WHERE code = ?`, code)
	return scanProduct(row)
}

type scanner interface {
	Scan(dest ...any) error
}

func productSelectSQL() string {
	return `SELECT code, description, packaging_description, photo_data_url, ncm, unit, balance, purchase_price, sale_price, tax_rate, tax_profile, cfop, csosn, product_type, origin, active, created_at, updated_at FROM products`
}

func scanProduct(row scanner) (product, error) {
	var p product
	var active int
	err := row.Scan(&p.Code, &p.Description, &p.PackagingDescription, &p.PhotoDataURL, &p.NCM, &p.Unit, &p.Balance, &p.PurchasePrice, &p.SalePrice, &p.TaxRate, &p.TaxProfile, &p.CFOP, &p.CSOSN, &p.ProductType, &p.Origin, &active, &p.CreatedAt, &p.UpdatedAt)
	p.Active = active == 1
	return p, err
}

func (p *product) normalize() {
	p.Code = strings.TrimSpace(p.Code)
	p.Description = strings.TrimSpace(p.Description)
	p.PackagingDescription = strings.TrimSpace(p.PackagingDescription)
	p.PhotoDataURL = strings.TrimSpace(p.PhotoDataURL)
	p.NCM = strings.TrimSpace(p.NCM)
	p.Unit = strings.TrimSpace(p.Unit)
	p.TaxProfile = strings.TrimSpace(p.TaxProfile)
	p.Origin = strings.TrimSpace(p.Origin)
	if p.Unit == "" {
		p.Unit = "UN"
	}
	if p.Origin == "" {
		p.Origin = "Nacional"
	}
	if p.TaxProfile == "" {
		p.TaxProfile = "Padrao"
	}
	if p.CFOP == "" {
		p.CFOP = "5102"
	}
	if p.CSOSN == "" {
		p.CSOSN = "102"
	}
	if p.ProductType == "" {
		p.ProductType = "Mercadoria para revenda"
	}
}

func (p product) validate() error {
	if p.Code == "" || p.Description == "" {
		return errors.New("Codigo e descricao sao obrigatorios")
	}
	if p.Balance < 0 {
		return errors.New("Saldo nao pode ser negativo")
	}
	if p.PurchasePrice < 0 || p.SalePrice < 0 || p.TaxRate < 0 {
		return errors.New("Valores e tributacao nao podem ser negativos")
	}
	return nil
}

func (s *server) isFailureMode() bool {
	s.failureLock.RLock()
	defer s.failureLock.RUnlock()
	return s.failureMode
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

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeAPIError(w http.ResponseWriter, status int, err apiError) {
	writeJSON(w, status, err)
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func env(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func init() {
	time.Local = time.UTC
}
