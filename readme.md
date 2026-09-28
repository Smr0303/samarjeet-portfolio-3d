# samarjeet-portfolio-3d

The 3D half of [samarjeet-portfolio-3d.vercel.app](https://samarjeet-portfolio-3d.vercel.app): a Three.js desk
scene whose CRT monitor loads the Windows-95 style OS from
[Smr0303/samarjeet-os](https://github.com/Smr0303/samarjeet-os) in an iframe.

Forked from [henryjeff/portfolio-website](https://github.com/henryjeff/portfolio-website) (MIT).
The scene, models, textures and sound design are Henry Heffernan's; the content is mine.

```bash
npm i
npm run dev      # webpack dev server on :8080
npm run build    # static build into public/
```

The monitor iframe URL lives in `src/Application/World/MonitorScreen.ts`. Point it at
`http://localhost:3000/` to develop against a local copy of the OS.
