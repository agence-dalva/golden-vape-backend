import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import type { ICacheService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, ProductWorkflowEvents } from "@medusajs/framework/utils"
import { INVALIDATED_AT_KEY, INVALIDATION_TTL } from "../lib/search-cache"

/*
  Périme la recherche dès qu'un produit change.

  Sans cela, un produit publié n'apparaissait dans la recherche qu'au bout d'une minute, le
  temps que son entrée de cache s'éteigne. Une minute est peu, mais elle se remarque quand on
  vient précisément de le mettre en rayon et qu'on vérifie.

  On ne cherche pas à effacer les entrées concernées : elles sont innombrables — une par terme
  cherché — et rien ne dit lesquelles mentionnaient ce produit. On pose une date, la route
  compare. Tout le cache de recherche est donc périmé d'un coup, ce qui est plus large que
  nécessaire mais sans conséquence : la première recherche qui suit le refait, en une
  vingtaine de millisecondes.

  L'écriture va dans le cache partagé, pas en mémoire du processus : le bus d'événements de
  Medusa est local, ce souscripteur ne s'exécute donc que sur l'instance qui a traité la
  modification. C'est Redis qui porte la nouvelle aux autres.
*/
export default async function invalidateSearchCache({ container }: SubscriberArgs): Promise<void> {
  const cache = container.resolve<ICacheService>(Modules.CACHE)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    await cache.set(INVALIDATED_AT_KEY, Date.now(), INVALIDATION_TTL)
  } catch (error) {
    /*
      Un cache injoignable ne doit pas faire échouer l'enregistrement d'un produit — il est
      déjà écrit en base quand ce souscripteur s'exécute. La recherche reprendra simplement
      son rythme d'avant : à jour au bout d'une minute.
    */
    logger.warn(
      `Cache de recherche non périmé : ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/*
  Les événements des workflows, et non ceux du module produit : ce sont eux qu'émettent
  l'administration et l'API pour toute création, modification ou suppression.

  Les variantes n'y sont pas. Une variante ajoutée ou repricée change bien la réponse — prix
  et déclinaisons y figurent — mais elle ne change pas ce qu'on trouve, et l'import Hiboutik
  en modifie par milliers : périmer le cache à chaque fois le désactiverait pendant toute la
  synchronisation. Ces changements-là suivent l'échéance d'une minute, comme le stock, qui de
  toute façon ne passe par aucun de ces événements.
*/
export const config: SubscriberConfig = {
  event: [
    ProductWorkflowEvents.CREATED,
    ProductWorkflowEvents.UPDATED,
    ProductWorkflowEvents.DELETED,
  ],
}
