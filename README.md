``` shell
npm install
npm run build
```
Then start whichever surface you want:

Web app:

``` shell
npm run dev
```

Open:

`http://127.0.0.1:3000/`

Generation service:

``` shell
npm run dev:service
```

Health check:

`http://127.0.0.1:3001/health`

Mobile app with Expo Go:

``` shell
npm run start -w apps/mobile -- --host lan --port 8082 --clear
```
Then scan the QR code with Expo Go.

If Expo Go still cannot connect, use tunnel mode:
``` shell
npm run start -w apps/mobile -- --host tunnel --port 8082 --clear
```