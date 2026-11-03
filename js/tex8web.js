// tex8web: MathJax's TeX input, adjusted to draw math at the sizes TeX does.
// tex8web(config, tex) returns MathJax's configuration with the adjustments
// hooked in. tex holds lengths from the document, in ems of its body font
// (tex8web-page.tex):
//   exscale: the math extension font's size (TeX draws \big delimiters and
//     large operators from it at its design size, 10pt, also in an 11pt
//     document)
//   baselineskip, jot: rows of arrays and alignments
//   pt: 1pt (MathJax reads pt as a tenth of an em)
// In a page, this file configures MathJax from the page's tex8web-config
// (see the end); prerender.mjs calls tex8web() itself.
//
// Some of this reaches into MathJax's internals (marked "internal"), which
// is why MathJax's version is pinned (package.json).
function tex8web(config, tex) {
  const startup = config.startup = config.startup || {};

  // \big and co.: delimiters of TeX's sizes (MathJax asks for 1.2em and up,
  // just above the glyph it has for \big, which then comes out a size larger)
  const bigSizes = {big: 1.19, Big: 1.79, bigg: 2.39, Bigg: 2.99};
  function sizeBigDelimiters() {
    // (internal: the macro map, and a macro's arguments)
    const macros = MathJax._.input.tex.MapHandler.MapHandler.getMap('macros');
    const factor = macros.lookup('big')._args[1] / 1.2;  // MathJax's size per em
    for (const [name, size] of Object.entries(bigSizes)) {
      for (const suffix of ['', 'l', 'r', 'm']) {
        const token = macros.lookup(name + suffix);
        if (token) token._args[1] = size * factor;
      }
    }
  }

  // MathJax's default space between rows (in its ems, in which 1pt is
  // 0.1em), and TeX's struts and space, for each environment (the
  // environments tex8web-math.tex numbers are listed there)
  const alignment = {rowspacing: 0.3, stretch: 1, space: tex.jot};
  const array = {rowspacing: 0.4, stretch: 1, space: 0};
  const environments = {
    align: alignment, 'align*': alignment, alignat: alignment, 'alignat*': alignment,
    flalign: alignment, 'flalign*': alignment, gather: alignment, 'gather*': alignment,
    aligned: alignment, alignedat: alignment, gathered: alignment, split: alignment,
    multline: {...alignment, rowspacing: 0.5}, 'multline*': {...alignment, rowspacing: 0.5},
    array: array, matrix: array, pmatrix: array, bmatrix: array, Bmatrix: array,
    vmatrix: array, Vmatrix: array,
    // (amsmath's cases sets \arraystretch to 1.2, and has two columns
    // a \quad apart, also when the second is empty)
    cases: {rowspacing: 0.2, stretch: 1.2, space: 0, columns: 2},
    dcases: {rowspacing: 0.2, stretch: 1.2, space: 0, columns: 2},
    rcases: {rowspacing: 0.2, stretch: 1.2, space: 0},
  };

  // the environment of each table, which MathJax doesn't record (an
  // mtable's data-latex holds its source with macros expanded): wrap the
  // environments' functions to mark the tables they make
  function markEnvironments(parseOptions) {
    // (internal: the environment handlers, and their functions)
    for (const {item} of parseOptions.handlers.get('environment')._configuration.items) {
      for (const [name, token] of item.map || []) {
        const make = token._func;
        token._func = function (parser, begin, ...args) {
          const result = make.call(this, parser, begin, ...args);
          if (result && result.arraydef) result.arraydef['data-tex8web-env'] = name;
          return result;
        };
      }
    }
  }

  function environment(mtable) {
    return environments[mtable.attributes.get('data-tex8web-env')];
  }

  function ems(length) {
    const [, value, unit] = String(length).match(/^([-\d.]+)(em|pt)?$/) || [, 0];
    return unit === 'pt' ? value / 10 : +value;
  }

  // rows on struts, 0.7 and 0.3 of the baselineskip (times \arraystretch)
  // above and below the baseline, and the space between them TeX's, plus
  // any \\[..]
  function spaceRows(mtable, env, factory) {
    const em = n => n.toFixed(3) + 'em';
    for (const row of mtable.childNodes) {
      const cell = row.childNodes[row.isKind('mlabeledtr') ? 1 : 0];
      if (!cell) continue;
      const strut = factory.create('node', 'mspace', [], {
        width: '0em',
        height: em(0.7 * tex.baselineskip * env.stretch),
        depth: em(0.3 * tex.baselineskip * env.stretch),
      });
      cell.childNodes[0].childNodes.unshift(strut);
      strut.parent = cell.childNodes[0];
    }
    const row = mtable.childNodes[0];
    if (row && env.columns > Math.max(...mtable.childNodes.map(row => row.childNodes.length))) {
      row.appendChild(factory.create('node', 'mtd'));
    }
    const spacing = String(mtable.attributes.get('rowspacing')).split(/\s+/).map(space =>
      em(Math.max(0, (ems(space) - env.rowspacing) * 10 * tex.pt + env.space)));
    mtable.attributes.set('rowspacing', spacing.join(' '));
  }

  const bars = ['|', '‖', '∥'];
  const wideAccents = ['^', '~'];
  let TEXCLASS;

  function adjust({data}) {
    const factory = data.nodeFactory;
    const scale = (100 * tex.exscale).toFixed(1) + '%';
    const operators = [];
    data.root.walkTree(node => {
      if (node.isKind('mtable')) {
        const env = environment(node);
        if (env) spaceRows(node, env, factory);
      } else if (node.isKind('mo')) {
        // inline math breaks after a relation or binary operator, as in TeX
        if (node.texClass === TEXCLASS.REL || node.texClass === TEXCLASS.BIN) {
          node.attributes.set('linebreakstyle', 'after');
        }
        const minsize = node.attributes.getExplicit('minsize');
        if (node.getProperty('mathaccent') && wideAccents.includes(node.getText())
            && node.attributes.getExplicit('stretchy') !== false) {
          // \widehat and \widetilde: the widest of TeX's sizes (0.556,
          // 1 and 1.444em) that isn't wider than what's under it, or the
          // narrowest (internal, getStretchedVariant: an accent gets the
          // size before the first one at least as wide as its base, that
          // width clamped to minsize and maxsize, so just above 0.556 and
          // 1.444em; without them it aims wider than the base, among sizes
          // from \hat's 0.5em to 1.889em)
          node.attributes.set('minsize', '0.557em');
          node.attributes.set('maxsize', '1.445em');
        } else if (minsize) {
          node.attributes.set('mathsize', scale);
          // TeX builds a big bar from pieces, a little (0.04em) taller
          // than the glyphs of the other delimiters
          if (bars.includes(node.getText())) {
            const size = (ems(minsize) + 0.04 / tex.exscale).toFixed(3) + 'em';
            node.attributes.set('minsize', size);
            node.attributes.set('maxsize', size);
          }
        } else if (node.attributes.get('largeop')) {
          operators.push(node);
        }
      }
    });
    // large operators: scaled around them, as MathJax misplaces the limits
    // of \int (tucked into its slant) when the <mo> itself is scaled
    for (const mo of operators) {
      const parent = mo.parent;
      const style = factory.create('node', 'mstyle', [], {mathsize: scale});
      parent.replaceChild(style, mo);
      style.childNodes[0].appendChild(mo);
    }
  }

  // the parts of an alignment split at \intertext (tex8web-math.tex), each
  // a formula with \webalignment{n} at its start: the same columns in each,
  // each column as wide as in its widest part, so the parts line up as TeX's
  // one alignment does
  function markAlignment(math) {
    math.math = math.math.replace(/\\webalignment\s*\{(\d+)\}/, (_, n) => {
      math.tex8webAlignment = n;
      // (internal: ui/lazy's flags, which would leave the formula
      // uncompiled until it's in view)
      math.lazyCompile = math.lazyTypeset = false;
      return '';
    });
  }
  function markAlignments(doc) {
    for (const math of doc.math) markAlignment(math);
  }
  // the top table of a part (none if MathJax couldn't parse it), and its
  // columns' widths (internal: its wrapper, made as getBBox makes it, with
  // the TeX classes that space operators, and a container for measuring
  // text)
  function measure(math, doc) {
    const jax = doc.outputJax;
    jax.setDocument(doc);
    jax.math = math;
    jax.container = jax.createNode();
    math.root.setTeXclass(null);
    jax.nodeMap = new Map();
    const wrappers = [jax.factory.wrap(math.root)];
    let table;
    while (!table && wrappers.length) {
      const wrapper = wrappers.shift();
      if (wrapper.node.isKind('mtable')) table = wrapper;
      else wrappers.push(...wrapper.childNodes);
    }
    jax.nodeMap = null;
    return table && {node: table.node, widths: table.getComputedWidths()};
  }
  function alignColumns(doc) {
    const alignments = {};
    for (const math of doc.math) {
      if (math.tex8webAlignment) (alignments[math.tex8webAlignment] ||= []).push(math);
    }
    for (const parts of Object.values(alignments)) {
      // (once per compiled formula: ui/lazy and the menu render the page
      // again, and the widths would then be the ones set here)
      if (parts.every(math => math.root.getProperty('tex8web-columns'))) continue;
      parts.forEach(math => math.root.setProperty('tex8web-columns', true));
      const tables = parts.map(math => measure(math, doc)).filter(Boolean);
      if (!tables.length) continue;
      const widths = [];
      for (const table of tables) {
        table.widths.forEach((width, i) => { widths[i] = Math.max(widths[i] || 0, width); });
      }
      // (a part with fewer columns gets those of the one with the most, with
      // their spacing and alignment, which MathJax sets per table; and
      // flalign's spacers stay as wide as the room left)
      const most = tables.find(table => table.widths.length === widths.length).node.attributes;
      const given = String(most.get('columnwidth')).split(' ');
      for (const {node, widths: own} of tables) {
        const row = node.childNodes[0];
        if (own.length < widths.length) {
          const cells = row.childNodes.length - (row.isKind('mlabeledtr') ? 1 : 0);
          for (let i = cells; i < widths.length; i++) row.appendChild(doc.mmlFactory.create('mtd'));
          for (const name of ['columnalign', 'columnspacing', 'data-break-align']) {
            node.attributes.set(name, most.getExplicit(name));
          }
        }
        // (rounded up, so that a cell's content fits)
        node.attributes.set('columnwidth', widths.map((w, i) =>
          given[i] === 'fit' ? 'fit' : Math.ceil(w * 1000) / 1000 + 'em').join(' '));
      }
    }
  }

  // (in the options, as the menu may make the document anew: before
  // compile (20), and after the metrics (110), which the widths need)
  const options = config.options = config.options || {};
  options.renderActions = {
    ...options.renderActions,
    tex8webAlignment: [15, markAlignments, markAlignment],
    tex8webColumns: [115, alignColumns, () => {}],
  };

  // macros.lua's definitions (the page's #tex8web-macros, as text), given
  // to MathJax before any math, which ui/lazy may typeset in any order
  // (internal: ui/lazy compiles math without a node, as tex2mml's is, at
  // once). A TeX error in one leaves the ones after it undefined
  const pageReady = startup.pageReady;
  startup.pageReady = function () {
    const doc = MathJax.startup.document;
    const [macros] = doc.adaptor.getElements(['#tex8web-macros'], doc.document);
    const mml = macros ? MathJax.tex2mml(doc.adaptor.textContent(macros)) : '';
    if (mml.includes('<merror')) console.warn('tex8web: a TeX error in a macro definition:', mml);
    return pageReady ? pageReady() : MathJax.startup.defaultPageReady();
  };

  const ready = startup.ready;
  startup.ready = function () {
    sizeBigDelimiters();
    if (ready) ready(); else MathJax.startup.defaultReady();
    TEXCLASS = MathJax._.core.MmlTree.MmlNode.TEXCLASS;
    const input = MathJax.startup.document.inputJax.find(jax => jax.name === 'TeX');
    markEnvironments(input.parseOptions);
    input.postFilters.add(adjust);
  };
  return config;
}

if (typeof document !== 'undefined') {
  const data = JSON.parse(document.getElementById('tex8web-config').textContent);
  window.MathJax = tex8web(data.mathjax, data.tex);
}
