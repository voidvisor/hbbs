# HBBS

HBBS (Hāgena balvas balsošanas sistēma) ir tīmekļa lietotne paradzēta balsošanas nodrošināšanai ikgadējai Āgenskalna Valsts ģimnāzijas Hāgena balvai.
## Funkcijas

* Balsošanas kodu ģenerēšana
* Balsošanas rezultātu apkopošana
* Balsošanas laika kontrole
* Viegli lietojama saskarne

## Tehniskā informācija

* Izveidots, izmantojot Next.js un React
* MariaDB datubāze
* 2 konteineru sistēmas arhitektūra ar nginx starpniekserveri

## Uzstādīšana un iestatīšana

1. Klonējiet repozitoriju
2. Instalējiet atkarības ar `npm i`
3. Izveidojiet `.env.local` failu un pievienojiet datubāzes akreditācijas datus.  
Piemērs:
```
DB_HOST=localhost
DB_USER=user
DB_PASSWORD=password
DB_NAME=hbbs
```
4. Palaidiet izstrādes serveri ar `npm run dev`

## Izvēršana

1. Izveidojiet Docker attēlus, izmantojot `docker compose build`.
2. Sagatavojiet SSL sertifikātu mapē `/etc/ssl`
3. Palaidiet lietotni ar `docker compose --env-file .env.local up`

## Ieguldījumi

Ja jums ir kādi ieteikumi vai ziņojumi par kļūdām, nekautrējieties atvērt issue vai izveidot pull request.

---

## Izveidot `standalone` versiju

```shell
rm -rf node_modules .next
npm ci
npm run build

rm -rf deploy
mkdir deploy
cp -a .next/standalone/. deploy/

mkdir -p deploy/.next
cp .next/BUILD_ID deploy/.next/
cp -a .next/static deploy/.next/
cp -a public deploy/
cp deploy/server.js deploy/app.js
```
