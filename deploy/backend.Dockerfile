FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/flowcbt-api ./cmd/api
RUN CGO_ENABLED=0 go build -o /out/flowcbt-worker ./cmd/worker

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /out/flowcbt-api /usr/local/bin/flowcbt-api
COPY --from=build /out/flowcbt-worker /usr/local/bin/flowcbt-worker
ENV TZ=Asia/Jakarta
EXPOSE 8080
CMD ["flowcbt-api"]
