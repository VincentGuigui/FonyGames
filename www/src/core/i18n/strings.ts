import { useLocale } from './LocaleContext';
import type { Locale } from './locale';

/**
 * The chrome every screen shares — hub, room/join picker, lobby, and the pieces
 * they're built from (`lobby/parts.tsx`). Game-specific text (`card.ts`, each
 * game's in-round strings) is not here; it travels with the game instead.
 * Spec: docs/specs/i18n.md
 */
export interface UiStrings {
  hub: {
    tagline: string;
    shellNotice: string;
    /**
     * The footer's privacy line. Rewritten 2026-08-20 — it used to claim nothing
     * is stored at all, which activity tracking made false. Spec: docs/specs/analytics.md §1.
     */
    privacy: string;
    sourceLink: string;
  };
  common: {
    howToPlay: string;
    allGames: string;
    leaveTheRoom: string;
    players: string;
    invitePlayer: string;
  };
  roomChoice: {
    tablistLabel: string;
    createTab: string;
    joinTab: string;
    createButton: string;
    createHint: string;
    joinPrompt: string;
    joinHint: string;
  };
  lobby: {
    soloOn: string;
    soloOnUnsupported: string;
  };
  noSuchRoom: {
    title: string;
    body: string;
    startNewRoom: (title: string) => string;
    enterCode: string;
  };
  orientation: {
    turnUpright: string;
    turnUprightNote: string;
    turnSideways: string;
    turnSidewaysNote: string;
  };
  localePicker: {
    label: string;
  };
  joinByCode: {
    defaultLabel: string;
    join: string;
    looking: string;
    notACode: (formatted: string) => string;
    wrongLength: (length: number) => string;
    noSuchRoom: (formatted: string) => string;
    serverUnreachable: string;
  };
  parts: {
    connecting: string;
    reconnecting: string;
    disconnected: string;
    roomCode: string;
    linkCopied: string;
    shareLink: string;
    hideQr: string;
    showQr: string;
    qrHint: string;
    host: string;
    away: string;
    change: string;
    profileSheetLabel: string;
    you: string;
    cancel: string;
    yourName: string;
    save: string;
    yourAvatar: string;
    useAvatar: (avatar: string) => string;
  };
}

const en: UiStrings = {
  hub: {
    tagline: 'Silly multiplayer games for the phone already in your pocket.',
    shellNotice: "Nothing is playable yet — this is the shell. Cards show what's coming.",
    privacy:
      "No install, no account. Positions and sensor readings never leave the room you're playing in. A little activity — what you tapped, roughly where from — is recorded to see how the site's actually used.",
    sourceLink: 'Source on GitHub',
  },
  common: {
    howToPlay: 'How to play',
    allGames: '← All games',
    leaveTheRoom: '← Leave the room',
    players: 'Players',
    invitePlayer: 'Invite a player',
  },
  roomChoice: {
    tablistLabel: 'Start or join a room',
    createTab: 'Create a room',
    joinTab: 'Join a room',
    createButton: 'Create the room',
    createHint: "You'll get a code and a link to share — everyone who opens it lands in your room.",
    joinPrompt: 'Got a code from a friend?',
    joinHint: "Any FonyGames code works here — it finds the right game on its own.",
  },
  lobby: {
    soloOn:
      'Solo testing is on: you can start on your own, and a round that would normally end when one player is left runs to its clock instead. Everything else is the real game.',
    soloOnUnsupported:
      'Solo testing is on, but not for this one — it is two phones facing each other across a gap, so there is no board to render alone. It still needs a second player.',
  },
  noSuchRoom: {
    title: "This room doesn't exist",
    body: 'The link may have been cut short or changed on its way to you. Ask for it again, or type the code by hand.',
    startNewRoom: (title) => `Start a new ${title} room`,
    enterCode: 'Enter a code',
  },
  orientation: {
    turnUpright: 'Turn your phone upright',
    turnUprightNote:
      'These games are played in portrait — the round is still going, it just does not fit sideways.',
    turnSideways: 'Turn your phone sideways',
    turnSidewaysNote:
      'This board is two grids side by side — the round is still going, it just does not fit upright.',
  },
  localePicker: {
    label: 'Language',
  },
  joinByCode: {
    defaultLabel: 'Got a code from a friend?',
    join: 'Join',
    looking: 'Looking…',
    notACode: (formatted) => `${formatted} is not a room code — codes read as two syllables, like FON-GAM.`,
    wrongLength: (length) => `A room code is ${length} letters, in two groups of three.`,
    noSuchRoom: (formatted) => `No room called ${formatted}. Check the code, or ask for the link.`,
    serverUnreachable: 'Could not reach the game server. Check your connection and try again.',
  },
  parts: {
    connecting: 'Connecting…',
    reconnecting: 'Connection lost — reconnecting…',
    disconnected: 'Disconnected.',
    roomCode: 'Room code',
    linkCopied: 'Link copied',
    shareLink: 'Share link',
    hideQr: 'Hide QR',
    showQr: 'Show QR',
    qrHint: 'Point a phone camera at this.',
    host: 'host',
    away: 'away',
    change: 'Change',
    profileSheetLabel: 'Your name and avatar',
    you: 'You',
    cancel: 'Cancel',
    yourName: 'Your name',
    save: 'Save',
    yourAvatar: 'Your avatar',
    useAvatar: (avatar) => `Use ${avatar}`,
  },
};

const fr: UiStrings = {
  hub: {
    tagline: 'Des jeux multijoueurs rigolos pour le téléphone que vous avez déjà en poche.',
    shellNotice: "Rien n'est encore jouable — c'est la coquille vide. Les cartes montrent ce qui arrive.",
    privacy:
      "Aucune installation, aucun compte. Les positions et données de capteurs ne sortent jamais de la salle où vous jouez. Un peu d'activité — ce que vous avez tapé, votre origine approximative — est enregistré pour voir comment le site est réellement utilisé.",
    sourceLink: 'Code source sur GitHub',
  },
  common: {
    howToPlay: 'Comment jouer',
    allGames: '← Tous les jeux',
    leaveTheRoom: '← Quitter la salle',
    players: 'Joueurs',
    invitePlayer: 'Inviter un joueur',
  },
  roomChoice: {
    tablistLabel: 'Créer ou rejoindre une salle',
    createTab: 'Créer une salle',
    joinTab: 'Rejoindre une salle',
    createButton: 'Créer la salle',
    createHint: 'Vous obtiendrez un code et un lien à partager — tous ceux qui l\'ouvrent arrivent dans votre salle.',
    joinPrompt: "Un code reçu d'un ami ?",
    joinHint: 'N\'importe quel code FonyGames fonctionne ici — il trouve le bon jeu tout seul.',
  },
  lobby: {
    soloOn:
      "Le test en solo est activé : vous pouvez démarrer seul, et une manche qui se terminerait normalement quand il ne reste qu'un joueur va jusqu'au bout du chrono à la place. Tout le reste est le jeu réel.",
    soloOnUnsupported:
      "Le test en solo est activé, mais pas pour ce jeu — ce sont deux téléphones face à face, donc il n'y a pas de plateau à afficher seul. Il faut toujours un second joueur.",
  },
  noSuchRoom: {
    title: "Cette salle n'existe pas",
    body: 'Le lien a peut-être été tronqué ou modifié en route. Demandez-le à nouveau, ou tapez le code à la main.',
    startNewRoom: (title) => `Démarrer une nouvelle salle ${title}`,
    enterCode: 'Entrer un code',
  },
  orientation: {
    turnUpright: 'Remettez votre téléphone à la verticale',
    turnUprightNote:
      'Ces jeux se jouent en mode portrait — la manche continue, elle ne s\'affiche simplement pas à l\'horizontale.',
    turnSideways: 'Tournez votre téléphone à l\'horizontale',
    turnSidewaysNote:
      'Ce plateau est composé de deux grilles côte à côte — la manche continue, elle ne s\'affiche simplement pas à la verticale.',
  },
  localePicker: {
    label: 'Langue',
  },
  joinByCode: {
    defaultLabel: "Un code reçu d'un ami ?",
    join: 'Rejoindre',
    looking: 'Recherche…',
    notACode: (formatted) =>
      `${formatted} n'est pas un code de salle — les codes se lisent en deux syllabes, comme FON-GAM.`,
    wrongLength: (length) => `Un code de salle fait ${length} lettres, en deux groupes de trois.`,
    noSuchRoom: (formatted) => `Aucune salle nommée ${formatted}. Vérifiez le code, ou demandez le lien.`,
    serverUnreachable: 'Impossible de joindre le serveur de jeu. Vérifiez votre connexion et réessayez.',
  },
  parts: {
    connecting: 'Connexion…',
    reconnecting: 'Connexion perdue — reconnexion…',
    disconnected: 'Déconnecté.',
    roomCode: 'Code de la salle',
    linkCopied: 'Lien copié',
    shareLink: 'Partager le lien',
    hideQr: 'Masquer le QR',
    showQr: 'Afficher le QR',
    qrHint: 'Pointez un appareil photo vers ceci.',
    host: 'hôte',
    away: 'absent',
    change: 'Modifier',
    profileSheetLabel: 'Votre nom et avatar',
    you: 'Vous',
    cancel: 'Annuler',
    yourName: 'Votre nom',
    save: 'Enregistrer',
    yourAvatar: 'Votre avatar',
    useAvatar: (avatar) => `Utiliser ${avatar}`,
  },
};

export const STRINGS: Record<Locale, UiStrings> = { en, fr };

export function useT(): UiStrings {
  return STRINGS[useLocale().locale];
}
