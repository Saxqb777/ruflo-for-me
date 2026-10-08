// The steps of the first-run walkthrough, in plain words for people who have never coded. Owner and tester
// differ only in the step about money. Each step points at a real part of the screen.
export function tourSteps(user, { showroom, setMode }) {
  const owner = user && user.role === 'owner';
  return [
    { title: `Welcome${user && user.display ? ', ' + user.display : ''}`, body: 'Binas builds things for you: a website, a game, a little tool. You describe it, a team of AI builders makes it, and you watch it happen. No code, ever.' },
    { target: '#projectForm', title: 'Start with an idea', body: 'Give it a short name, then describe it the way you would to a friend: what it is, who it is for, and what “done” looks like. Pick one below to see a good example.', chips: (showroom.ideas || []).slice(0, 3).map((it, i) => ({ label: it.label, onPick: () => showroom.fillIdea(i) })) },
    { target: '#stage', title: 'Watch it get built', body: 'This is your build plate. Every block is a piece the team writes, and it grows as they write more. The orange print head shows exactly what is being worked on right now.', onShow: () => setMode('build') },
    { target: '#rail', title: 'Follow the steps', body: 'The line on top is the plan: understand your idea, design the look, build, test, check it on a phone, review, then put it online. The orange stop is happening now.', onShow: () => setMode('build') },
    { target: '#yes', title: 'Answer with one tap', body: 'Sometimes the team needs your call, like a colour or a feature. The question shows up here and in your chat with buttons. The first button is the one they recommend.' },
    { target: '#projects', title: 'Keep talking to it', body: 'When a round is done you get a live link. Play with it, then tell the team what to change: “make it darker”, “add a scoreboard”. Each message is a new round, one at a time.' },
    owner
      ? { target: '#building', title: 'Your building', body: 'You see every floor here. When a friend’s round needs more than their monthly budget, it waits in your Approvals tray until you say yes.' }
      : { target: '#jobStatus', title: 'Your building budget', body: 'You have a monthly budget for building. Bigger changes use more of it. If a round needs more than you have left, the owner is asked before it runs.' },
    { title: 'Ready?', body: 'Your first build is four steps: describe an idea, watch it get built, open it live, ask for one change. The checklist under Projects ticks them off as you go.', cta: 'Start my first build', onFinish: () => { const t = document.querySelector('#projectForm [name=title]'); if (t) t.focus(); } },
  ];
}
