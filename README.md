# RingFlow

Real-time karate tournament floor management and scoring: draws, ring balancing, a scoring pad for
table officials, arena scoreboards, kata judge phones, a public portal and an official record.

The application is in [RingFlow-CISCE/](RingFlow-CISCE/). Start with its
[README](RingFlow-CISCE/README.md) for features, roles and the documentation index.

To run it locally:

```bash
cd RingFlow-CISCE
npm install
cp .env.example .env.local
docker compose up -d db
npm run db:push && npm run db:migrate && npm run db:seed
npm run dev
```

Details and a guided tour: [RingFlow-CISCE/QUICKSTART.md](RingFlow-CISCE/QUICKSTART.md).
