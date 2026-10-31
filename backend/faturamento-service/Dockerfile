FROM golang:1.23-alpine AS build

WORKDIR /app
COPY go.mod ./
COPY . .
RUN go mod tidy
RUN CGO_ENABLED=0 GOOS=linux go build -o faturamento-service .

FROM alpine:3.20

WORKDIR /app
COPY --from=build /app/faturamento-service .
EXPOSE 8082
CMD ["./faturamento-service"]
