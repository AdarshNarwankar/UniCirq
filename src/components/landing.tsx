'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUpRight, ArrowRight, Check, Menu, X, ShieldCheck, MapPin, MessageCircle, Plus } from 'lucide-react';
import { Brand } from './brand';
import { CampusArtwork } from './campus-artwork';

const chapters = [
  { label: 'LESS BUYING NEW', title: 'Your next find.\nSomeone’s next chapter.', body: 'The textbook for next semester. A desk for your new room. Find good things from people just a few minutes away.', tags: ['Buy & sell', 'Room essentials', 'Books & notes'] },
  { label: 'MORE POSSIBILITIES', title: 'Need it for a day?\nMake it yours for a day.', body: 'A camera for the college fest. Gear for your next project. Rent what you need, agree on the details, and bring it back for the next person.', tags: ['Rentals', 'Project hardware', 'Direct conversations'] },
  { label: 'A LITTLE CAMPUS MAGIC', title: 'There’s a person\nfor that.', body: 'Find a tutor, a creative collaborator, or a student with the skill you need. Can’t find it? Put a request out to your campus.', tags: ['Student skills', 'Campus requests', 'Local offers'] },
];

export function Landing({ destination = '/signup', signedIn = false }: { destination?: string; signedIn?: boolean }) {
  const [menu, setMenu] = useState(false);
  const [chapter, setChapter] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add('uc-visible');
        const index = (entry.target as HTMLElement).dataset.chapter;
        if (index !== undefined) setChapter(Number(index));
      }
    }, { rootMargin: '-35% 0px -45% 0px', threshold: 0 });
    element.querySelectorAll('[data-reveal], [data-chapter]').forEach(item => observer.observe(item));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const update = () => {
      frame = 0;
      element.style.setProperty('--hero-scroll', String(reduced.matches ? 0 : Math.min(window.scrollY / window.innerHeight, 1)));
    };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(false); menuButton.current?.focus(); } };
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('keydown', escape);
    update();
    return () => { observer.disconnect(); window.removeEventListener('scroll', scroll); window.removeEventListener('keydown', escape); cancelAnimationFrame(frame); };
  }, []);
  return <div className="uc-landing" ref={root}>
    <a className="skip-link" href="#landing-content">Skip to content</a>
    <header className="uc-nav"><Brand /><nav className={menu ? 'uc-nav-links is-open' : 'uc-nav-links'} id="landing-navigation" aria-label="Main navigation">
      <a href="#the-circle" onClick={() => setMenu(false)}>The idea</a><a href="#how-it-works" onClick={() => setMenu(false)}>How it works</a><a href="#campus-first" onClick={() => setMenu(false)}>Campus first</a>
    </nav><div className="uc-nav-actions"><Link href={signedIn ? destination : '/login'} className="uc-signin">{signedIn ? 'Your workspace' : 'Log in'}</Link><Link className="uc-button uc-button-small" href={destination}>{signedIn ? 'Go to campus' : 'Find your circle'}<ArrowUpRight size={16} /></Link><button ref={menuButton} className="uc-menu-button" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu} aria-controls="landing-navigation" onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button></div></header>
    <main id="landing-content">
      <section className="uc-hero">
        <div className="uc-hero-copy"><span className="uc-overline"><i /> THE STUDENT-TO-STUDENT MARKETPLACE</span><h1>Good things.<br /><em>Come around.</em></h1><p>Buy a little smarter. Rent what you need.<br className="uc-desktop-break" /> Find your people. All on your campus.</p><div className="uc-hero-actions"><Link href={destination} className="uc-button">Find your campus<ArrowUpRight size={19} /></Link><a href="#the-circle" className="uc-text-link">Take a look around<ArrowDown size={16} /></a></div><div className="uc-hero-caption"><span className="uc-mini-orbits" aria-hidden="true"><i /><i /><i /></span><span>Buy. Sell. Rent. Connect.<br /><strong>All within your campus circle.</strong></span></div></div>
        <div className="uc-hero-art"><span className="uc-art-index">THE CAMPUS COLLECTION — VOL. 01</span><CampusArtwork priority alt="A sculptural blue circle surrounded by textbooks, headphones, a camera and a coffee mug" /><div className="uc-art-tag uc-art-tag-one"><span className="uc-dot" />Good finds. Close by.<ArrowUpRight size={16} /></div><div className="uc-art-seal" aria-hidden="true"><span>LESS NEW.</span><ArrowUpRight size={27}/><span>MORE POSSIBLE.</span></div></div>
        <div className="uc-hero-bottom"><span>A CAMPUS MARKETPLACE. A COMMUNITY IN MOTION.</span><a href="#the-circle">SCROLL TO EXPLORE<ArrowDown size={14} /></a></div>
      </section>
      <nav className="uc-intro-index" aria-label="Explore the campus circle">
        <a href="#chapter-0"><span>01</span><div><strong>Find your next favourite.</strong><small>Buy & sell · Books, tech, everyday things</small></div><ArrowUpRight size={22}/></a>
        <a href="#chapter-1"><span>02</span><div><strong>Just for the moment.</strong><small>Rent · Gear for whatever comes next</small></div><ArrowUpRight size={22}/></a>
        <a href="#chapter-2"><span>03</span><div><strong>There’s a person for that.</strong><small>Connect · Skills, tutors & campus requests</small></div><ArrowUpRight size={22}/></a>
      </nav>
      <section id="the-circle" className="uc-story">
        <div className="uc-section-heading" data-reveal><span className="uc-overline">01 / THE CIRCLE EFFECT</span><h2>A whole campus.<br /><span>A little closer.</span></h2><p>Useful things. Helpful people. Everyday possibilities.<br />They’re already around you. Let’s connect the dots.</p></div>
        <div className="uc-story-grid"><CampusScene chapter={chapter} /><div className="uc-chapters">{chapters.map((item, index) => <article className="uc-chapter" id={`chapter-${index}`} data-chapter={index} key={item.label}><CampusScene chapter={index} mobile /><span className="uc-overline">0{index + 1} / {item.label}</span><h3>{item.title.split('\n').map((line, i) => <span key={line}>{line}{i === 0 && <br />}</span>)}</h3><p>{item.body}</p><div className="uc-chapter-tags">{item.tags.map(tag => <span key={tag}>{tag}</span>)}</div><Link className="uc-text-link" href={destination}>Step into your circle<ArrowUpRight size={18} /></Link></article>)}</div></div>
      </section>
      <section id="how-it-works" className="uc-how"><div className="uc-how-heading"><span className="uc-overline">02 / FROM A FIND TO A HELLO</span><h2>Small steps.<br /><span>Good connections.</span></h2><p>Keep the conversation, the details, and your exchange in one place.</p></div><div className="uc-how-steps">{[
        ['01', 'Find your campus.', 'Create an account and choose your university. Browse the things and people in your own corner of the world.', MapPin],
        ['02', 'Start a conversation.', 'See something you like? Ask a question, agree on the terms, and arrange a convenient place to meet.', MessageCircle],
        ['03', 'Meet. Exchange. Repeat.', 'Meet in a public place, inspect together, and confirm the handover. Good things keep moving.', ArrowUpRight],
      ].map(([number, title, text, Icon]) => { const StepIcon = Icon as typeof MapPin; return <article key={String(number)} data-reveal><span className="uc-step-number">{String(number)}</span><div><h3>{String(title)}</h3><p>{String(text)}</p></div><StepIcon size={26} strokeWidth={1.4} /></article>; })}</div></section>
      <section id="campus-first" className="uc-trust"><div className="uc-trust-visual" aria-hidden="true"><div className="uc-campus-card"><span>MEMBER OF THE CIRCLE</span><div className="uc-campus-emblem"><span className="uc-mark"><i /><i /></span></div><strong>Campus first.<br />People always.</strong><div className="uc-card-rule" /><small>UNI / CIR Q</small><ShieldCheck size={28} /></div><div className="uc-trust-stamp">A LITTLE<br /><strong>CLOSER</strong><br />TO HOME ↗</div></div><div className="uc-trust-copy"><span className="uc-overline">03 / FAMILIAR GROUND</span><h2>A community.<br /><span>With a campus<br />in common.</span></h2><p>UniCirq starts with the place you share. Campus eligibility is reviewed separately from email verification, so joining and getting verified each have a clear purpose.</p><ul><li><Check size={18} />Campus-scoped discovery</li><li><Check size={18} />Reviewed campus & business verification</li><li><Check size={18} />Private conversations & recorded exchanges</li></ul><p className="uc-trust-fine">Exchanges and payments are arranged directly between members. Meet safely and inspect before you agree.</p></div></section>
      <section className="uc-business-band"><span className="uc-overline">FOR THE PLACES THAT MAKE CAMPUS, CAMPUS.</span><h2>The café around the corner.<br />The shop that knows your name.</h2><div><p>Local businesses belong in the circle, too.<br />Get verified and share offers with your campus.</p><Link href={destination} className="uc-text-link">Join as a campus business<ArrowUpRight size={18} /></Link></div></section>
      <section className="uc-faq"><div><span className="uc-overline">A FEW THINGS YOU MIGHT WONDER</span><h2>Before you<br /><span>come around.</span></h2></div><div>{[
        ['Who is UniCirq for?', 'Students looking to buy, sell, rent, share skills, and connect within a supported campus. Local businesses can also apply for verification to share campus offers.'],
        ['How do I get campus verified?', 'First verify your email and choose your university. Then submit a campus verification application from your profile. A reviewer checks your eligibility before approving it.'],
        ['Can I rent something instead of buying it?', 'Yes. Rental listings include a daily price and a date range. Agree with the owner, record the handover, and return the item at the end of your rental.'],
        ['How do payments and pickups work?', 'Members arrange payments and meetups directly. UniCirq records requests and participant confirmations, but does not process payments or provide escrow.'],
      ].map(([question, answer]) => <details key={question}><summary>{question}<Plus size={20} /></summary><p>{answer}</p></details>)}</div></section>
      <section className="uc-final"><span className="uc-overline">YOUR NEXT CHAPTER STARTS NEARBY.</span><h2>Come find<br />your <span>circle.</span><ArrowUpRight aria-hidden="true" /></h2><div><p>Good things. Good people.<br />Right here on your campus.</p><Link className="uc-button uc-button-light" href={destination}>{signedIn ? 'Go to your workspace' : 'Let’s get you in'}<ArrowUpRight size={20} /></Link></div><span className="uc-final-orbit" aria-hidden="true" /></section>
    </main>
    <footer className="uc-footer"><Brand /><span>Your campus. Connected.</span><div><a href="#the-circle">The idea</a><Link href="/login">Log in</Link><a href="#campus-first">Trust & community</a></div><small>© {new Date().getFullYear()} UniCirq</small></footer>
  </div>;
}

function CampusScene({ chapter, mobile = false }: { chapter: number; mobile?: boolean }) {
  return <div className={`uc-story-scene scene-${chapter} ${mobile ? "uc-mobile-scene" : ""}`} aria-hidden="true"><div className="uc-scene-top"><span>THE EVERYDAY COLLECTION</span><span>0{chapter + 1} / 03</span></div>
          <div className="uc-scene-layer uc-scene-books"><div className="uc-book uc-book-back"><span>notes<br />for the<br />next one.</span></div><div className="uc-book uc-book-front"><small>PASS IT ON</small><strong>Good<br />things<br />inside.</strong><span>THE CAMPUS EDITION / VOL. 01</span></div><span className="uc-object-sticker">A NEW<br />CHAPTER ↗</span></div>
          <div className="uc-scene-layer uc-scene-camera"><div className="uc-camera"><div className="uc-camera-top" /><div className="uc-camera-flash" /><div className="uc-camera-lens"><i /></div><span>CAMPUS / 35</span></div><div className="uc-camera-ticket">ONE FEST.<br />A HUNDRED MEMORIES.<small>Rent the gear. Keep the moment.</small></div></div>
          <div className="uc-scene-layer uc-scene-notes"><div className="uc-pin-note"><span>CAMPUS NOTICEBOARD</span><strong>Anyone good<br />with calculus?</strong><small>Your next study buddy could<br />be a few doors down.</small><div>LET’S FIGURE IT OUT ↗</div></div><div className="uc-skill-note">You’ve got a skill.<br /><em>Someone needs it.</em><span>✳</span></div></div>
          <div className="uc-scene-bottom"><span>MADE FOR CAMPUS LIFE</span><div>{chapters.map((_, index) => <i key={index} className={chapter === index ? 'active' : ''} />)}</div></div>
        </div>;
}
