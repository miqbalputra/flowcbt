// stamp.go — waktu server untuk label PDF (dipisah agar mudah diuji).
package pdfgen

import "time"

var nowFunc = time.Now

func stampNow() string { return nowFunc().Format("02/01/2006 15:04") }
