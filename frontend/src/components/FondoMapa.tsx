export default function FondoMapa() {
  return (
    <div className="fondo" aria-hidden="true">
      <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" focusable="false">
        <rect width="1000" height="1000" fill="#fef1da" />

        {/* manzanas y calles secundarias */}
        <g stroke="#f3dcbc" strokeWidth="3" fill="none">
          <path d="M-20 140 L1020 60M-20 330 L1020 250M-20 560 L1020 500M-20 790 L1020 740" />
          <path d="M120 -20 L60 1020M330 -20 L290 1020M560 -20 L560 1020M780 -20 L830 1020" />
          <path d="M-20 900 L520 520 L1020 420" />
        </g>

        {/* parques y zonas verdes */}
        <g fill="#a8d08c">
          <path d="M-20 -20 H330 C300 90 200 130 120 150 C60 165 20 210 -20 230Z" />
          <path d="M640 -20 H1020 V210 C940 190 880 140 800 130 C720 120 660 70 640 -20Z" opacity=".85" />
          <path d="M560 1020 C580 900 670 840 780 850 C880 860 960 820 1020 840 V1020Z" />
          <path d="M380 560 C420 520 500 520 520 570 C540 620 480 660 420 650 C370 640 350 600 380 560Z" opacity=".7" />
        </g>
        <g fill="#bdd79c" opacity=".8">
          <path d="M70 420 C110 390 180 400 190 450 C200 500 140 520 90 505 C50 490 40 450 70 420Z" />
          <path d="M840 520 C880 490 950 500 960 550 C968 600 910 620 865 606 C820 590 810 550 840 520Z" />
        </g>

        {/* río y lago */}
        <path d="M-20 700 C40 650 110 690 120 760 C128 830 60 880 -20 870Z" fill="#6cd0ec" />
        <path d="M70 740 C170 600 150 470 330 400 S600 260 720 250 S900 170 1020 190" fill="none" stroke="#6cd0ec" strokeWidth="18" strokeLinecap="round" />

        {/* avenidas */}
        <path d="M200 1020 C250 880 420 840 470 650 S560 280 640 -20" fill="none" stroke="#f6b04a" strokeWidth="26" strokeLinecap="round" opacity=".85" />
        <path d="M-20 520 C170 480 300 600 470 560 S760 420 1020 470" fill="none" stroke="#f6b04a" strokeWidth="20" strokeLinecap="round" opacity=".7" />
        <path d="M-20 330 C160 300 300 400 470 360 S800 220 1020 300" fill="none" stroke="#f08868" strokeWidth="9" strokeLinecap="round" />
        <path d="M700 1020 C720 880 640 760 760 650 S940 560 1020 540" fill="none" stroke="#f08868" strokeWidth="9" strokeLinecap="round" />

        {/* ruta punteada que "camina" despacio */}
        <path className="ruta-anim" d="M60 960 C240 780 120 600 360 520 S520 300 700 240 S900 120 960 40" fill="none" stroke="#4a3560" strokeOpacity=".45" strokeWidth="5" strokeLinecap="round" strokeDasharray="1 16" />
      </svg>
    </div>
  );
}