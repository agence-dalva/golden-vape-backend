import { loadEnv, defineConfig } from '@medusajs/framework/utils'
import { moneticoOptionsFromEnv } from './src/modules/monetico/lib/options'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    /*
      Compression des réponses HTTP, désactivée par défaut chez Medusa.

      Mesuré sur la recherche : 27 747 octets bruts contre 6 447 une fois gzippés, soit 4,3×.
      Le catalogue et la navigation sont du JSON tout aussi répétitif. Le gain porte sur
      l'égress de Railway autant que sur le temps de transfert.

      Seuil laissé à sa valeur par défaut, 1 024 octets : en deçà, l'en-tête gzip coûte plus
      que ce qu'il économise — la réponse d'une recherche sans résultat fait quarante octets.
    */
    http: {
      compression: {
        enabled: true,
      },
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    }
  },
  modules: [
    /*
      Le cache de Medusa sur Redis, plutôt que dans la mémoire du processus.

      Par défaut Medusa résout le module cache sur `cache-inmemory` : le cache n'est alors
      partagé ni entre deux répliques, ni entre deux redémarrages. Redis est pourtant déjà là
      — `redisUrl` plus haut lui confie les sessions — mais le framework ne bascule cache,
      bus d'événements et moteur de workflow dessus tout seul que sur son propre hébergement,
      quand `EXECUTION_CONTEXT` vaut `medusa-cloud`. Sur Railway, cette variable n'existe pas
      et la bascule ne se déclenche jamais. D'où cette déclaration explicite.

      Conditionnée à la présence de l'URL : en développement, sans Redis, Medusa retombe sur
      le cache mémoire et le code appelant ne voit pas la différence.
    */
    ...(process.env.REDIS_URL
      ? [
          {
            resolve: "@medusajs/medusa/cache-redis",
            options: { redisUrl: process.env.REDIS_URL },
          },
        ]
      : []),
    {
      resolve: "./src/modules/product-attribute",
    },
    {
      resolve: "@medusajs/payment",
      options: {
        providers: [
          {
            resolve: "./src/modules/monetico",
            id: "monetico",
            options: moneticoOptionsFromEnv(),
          },
        ],
      },
    },
    {
      resolve: "@medusajs/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/file-s3",
            id: "s3",
            options: {
              file_url: process.env.R2_PUBLIC_URL,
              access_key_id: process.env.R2_ACCESS_KEY_ID,
              secret_access_key: process.env.R2_SECRET_ACCESS_KEY,
              region: "auto",
              bucket: process.env.R2_BUCKET,
              endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            },
          },
        ],
      },
    },
  ],
})
