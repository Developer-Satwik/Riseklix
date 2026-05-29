// Riseklix portfolio video config
// These Drive file links power the Reel Vault on the Work page.
// The site first tries to play each Drive file through a native HTML video element.
// If Drive blocks direct streaming, it falls back to the normal Drive preview iframe and stays manual instead of cutting early.
// For the most polished production setup, place compressed MP4s in /assets/reels/ and use: src: '/assets/reels/your-file.mp4'.

window.RISEKLIX_PORTFOLIO_FOLDER = 'https://drive.google.com/drive/folders/1B0jFiVURGXHkuLzrDApdlou8Uop3_1U0';

window.RISEKLIX_PORTFOLIO_VIDEOS = [
  {
    title: 'Hook-first edit',
    label: 'Portfolio piece',
    driveUrl: 'https://drive.google.com/file/d/1IIu0fkZLsijUlhyu9oJzP2swp2V-Zbok/view?usp=sharing',
    note: 'A social-native edit built around quick comprehension, visual pacing, and strong first-frame retention.'
  },
  {
    title: 'Retention cut',
    label: 'Creator asset',
    driveUrl: 'https://drive.google.com/file/d/1gnF00Sx1iyeow36rOB-5QWY3HOQudyQM/view?usp=sharing',
    note: 'A clean proof piece showing caption rhythm, scene timing, and scroll-stopping structure.'
  },
  {
    title: 'Visual story',
    label: 'Brand narrative',
    driveUrl: 'https://drive.google.com/file/d/1rTpN2AngWRuuPfLnENmbBwRaXjjbIVZH/view?usp=sharing',
    note: 'Designed to make a message feel easier to understand while keeping the creative premium.'
  },
  {
    title: 'Creator system',
    label: 'Content engine',
    driveUrl: 'https://drive.google.com/file/d/14citfR1FgyjgV9bmP1t3hS_mv0IbmzF7/view?usp=sharing',
    note: 'Shows how raw ideas can be converted into stronger platform-native assets.'
  },
  {
    title: 'Motion edit',
    label: 'Motion + captions',
    driveUrl: 'https://drive.google.com/file/d/1ThZn28flTB5W0SrpaxPbVqFq5ibjD4Mi/view?usp=sharing',
    note: 'A motion-led edit focused on typography, timing, and visual hierarchy.'
  },
  {
    title: 'Brand asset',
    label: 'B2B / B2C proof',
    driveUrl: 'https://drive.google.com/file/d/1YMIRlr0A-8oq2SeuG-yc5XZxg50GrKi4/view?usp=sharing',
    note: 'A brand-facing reel built to package authority, attention, and clarity together.'
  },
  {
    title: 'Social proof',
    label: 'Proof layer',
    driveUrl: 'https://drive.google.com/file/d/1bh3A4u6chN6E3Yjn7WVOO26u95f4p6yj/view?usp=sharing',
    note: 'A portfolio slot that lets visitors immediately feel the editing direction and energy.'
  },
  {
    title: 'Platform native',
    label: 'Vertical reel',
    driveUrl: 'https://drive.google.com/file/d/12MREfBq9-06IZR3W1pshrngsbq0Nf63x/view?usp=sharing',
    note: 'A vertical short-form piece shaped for social feeds rather than a generic website embed.'
  },
  {
    title: 'Campaign cut',
    label: 'Offer asset',
    driveUrl: 'https://drive.google.com/file/d/1W7vcgMlsI9fzDWbO-CLA9cAd9ce-KOhS/view?usp=sharing',
    note: 'Built for campaigns where the content has to carry a bigger offer narrative.'
  },
  {
    title: 'Vault piece',
    label: 'Portfolio loop',
    driveUrl: 'https://drive.google.com/file/d/1V3kXmpnq2iu9MmVCntRhD8O_BoHke29F/view?usp=sharing',
    note: 'A final reel in the loop that keeps the portfolio feeling alive without rushing the viewer.'
  }
];
