/*
  Clés et durées du cache de la recherche, partagées entre la route qui les écrit et le
  souscripteur qui les périme. Les tenir au même endroit évite la panne silencieuse classique :
  deux fichiers qui divergent d'un caractère sur un nom de clé, et l'invalidation ne périme
  plus rien sans que rien n'échoue.
*/

/** À incrémenter dès que la forme de la réponse change : sinon un déploiement servirait
    pendant une minute des réponses à l'ancien format. */
const VERSION = "v1"

/*
  Soixante secondes : assez pour absorber une rafale de frappes et les recherches identiques
  de visiteurs différents. Une recherche sans résultat est gardée deux fois moins longtemps —
  c'est souvent une faute de frappe, inutile de la retenir, mais assez pour qu'un script qui
  la répète ne réveille pas la base à chaque fois.
*/
export const SEARCH_TTL = 60
export const SEARCH_TTL_EMPTY = 30

/*
  Horodatage du dernier changement au catalogue.

  Le cache ne sait pas effacer par préfixe, et les clés de recherche sont innombrables — une
  par terme cherché. Plutôt que de les traquer, on marque la date du dernier changement : une
  entrée écrite avant cette date est tenue pour périmée et refaite. Rien n'est effacé, les
  entrées mortes s'éteignent d'elles-mêmes à leur échéance.

  La marque vit bien plus longtemps que les entrées qu'elle périme. C'est la condition pour
  qu'elle ne disparaisse jamais avant elles : sans quoi une entrée écrite avant un changement
  redeviendrait valide en perdant ce qui l'invalidait.
*/
export const INVALIDATED_AT_KEY = `search:${VERSION}:invalidated-at`
export const INVALIDATION_TTL = 3600

/**
 * La clé est bâtie sur le terme replié, pas sur la saisie : « Fraise », « fraise » et
 * « FRAÎSE » donnent les mêmes résultats, autant qu'ils partagent la même entrée. Le repliage
 * ne laisse que des minuscules, des chiffres et des espaces, rien qui puisse casser une clé
 * Redis.
 *
 * La limite en fait partie, elle change la réponse. La région n'y est pas : la route ne sait
 * lire que la première, la réponse ne peut donc pas varier de ce côté — l'y mettre coûterait
 * une requête pour une clé qui ne prendrait jamais deux valeurs.
 *
 * Rien ici ne dépend du client : ni panier, ni compte, ni prix négocié. La clé est donc
 * partageable entre tous les visiteurs, ce qui est la condition pour qu'un cache serve.
 */
export function searchCacheKey(take: number, normalized: string): string {
  return `search:${VERSION}:${take}:${normalized}`
}
