// Public betting splits -> sharp-money signals.
// "Sharp" side: money % runs at least 10 points ahead of ticket %, meaning fewer but larger bets.
// Reverse line movement (RLM): most tickets are on one side but the line moved the other way.

export function publicSignals(game) {
  const pub = game.public;
  if (!pub) return null;
  const signals = [];

  if (pub.spread) {
    const gap = pub.spread.homeMoney - pub.spread.homeTickets;
    if (Math.abs(gap) >= 10) {
      const side = gap > 0 ? game.home.abbr : game.away.abbr;
      signals.push({ type: 'sharp', market: 'spread', side, text: `Sharp split: ${side} has ${Math.abs(gap)} pts more money than tickets.` });
    }
    if (game.spread?.open != null) {
      const move = game.spread.line - game.spread.open; // >0: line moved toward away
      if (pub.spread.homeTickets >= 60 && move > 0) signals.push({ type: 'rlm', market: 'spread', side: game.away.abbr, text: `Reverse line move: ${pub.spread.homeTickets}% of tickets on ${game.home.abbr}, but the line moved toward ${game.away.abbr} (${game.spread.open} → ${game.spread.line}).` });
      if (pub.spread.homeTickets <= 40 && move < 0) signals.push({ type: 'rlm', market: 'spread', side: game.home.abbr, text: `Reverse line move: ${100 - pub.spread.homeTickets}% of tickets on ${game.away.abbr}, but the line moved toward ${game.home.abbr} (${game.spread.open} → ${game.spread.line}).` });
    }
  }
  if (pub.total) {
    const gap = pub.total.overMoney - pub.total.overTickets;
    if (Math.abs(gap) >= 10) signals.push({ type: 'sharp', market: 'total', side: gap > 0 ? 'over' : 'under', text: `Sharp split on the total: ${gap > 0 ? 'Over' : 'Under'} has ${Math.abs(gap)} pts more money than tickets.` });
    if (game.total?.open != null) {
      const move = game.total.line - game.total.open;
      if (pub.total.overTickets >= 60 && move < 0) signals.push({ type: 'rlm', market: 'total', side: 'under', text: `Reverse line move: ${pub.total.overTickets}% of tickets on the Over, but the total dropped (${game.total.open} → ${game.total.line}).` });
      if (pub.total.overTickets <= 40 && move > 0) signals.push({ type: 'rlm', market: 'total', side: 'over', text: `Reverse line move: ${100 - pub.total.overTickets}% of tickets on the Under, but the total rose (${game.total.open} → ${game.total.line}).` });
    }
  }
  return signals;
}
