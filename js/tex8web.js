// tex8web: MathJax's TeX input, adjusted to draw math at the sizes TeX does
// (CONTRIBUTING.md, "MathJax sizes"). tex8web(config, tex) returns MathJax's
// configuration with the adjustments hooked in. tex holds lengths from the
// document, in ems of its body font (tex8web-page.tex):
//   exscale: the math extension font's size (TeX draws \big delimiters and
//     large operators from it at its design size, 10pt, also in an 11pt
//     document)
//   baselineskip, jot: rows of arrays and alignments
//   arraycolsep: the columns of arrays and matrices
//   pt: 1pt (MathJax reads pt as a tenth of an em)
// In a page, this file configures MathJax from the page's tex8web-config
// (at the end); prerender.mjs calls tex8web() itself.
//
// Code marked "internal" uses MathJax's internals, so MathJax's version is
// pinned in package.json.
function tex8web(config, tex) {
  const startup = config.startup = config.startup || {};
  const loader = config.loader = config.loader || {};

  // \big and co.: delimiters of TeX's sizes. MathJax asks for 1.2em and up,
  // a little above its glyph for \big, which then comes out a size larger.
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

  // each table row as high as MathJax means it to be. MathJax adds the rule
  // below a row to the row's height, and the last row has none (internal:
  // the table wrapper's rLines, one short). The last row's height is then
  // NaN, which Node writes as NaNem and a browser ignores, keeping any height
  // the row had from an earlier rendering.
  function fixRowHeights() {
    const Mtable = MathJax._.output.chtml.Wrappers.mtable.ChtmlMtable.prototype;
    const updateRowHeights = Mtable.updateRowHeights;
    Mtable.updateRowHeights = function () {
      const lines = this.rLines;
      this.rLines = [...lines, 0];
      updateRowHeights.call(this);
      this.rLines = lines;
    };
  }

  // how far right the content of the boxes of no width in a table's rows
  // reaches, from the table's left edge
  function lapEnd(table, numbered) {
    const widths = table.getComputedWidths(), spacing = table.getColumnHalfSpacing();
    let end = 0;
    for (const row of table.tableRows) {
      if (numbered && !row.node.isKind('mlabeledtr')) continue;
      let x = 0;
      row.tableCells.forEach((cell, i) => {
        x += spacing[i];
        const content = cell.childNodes[0];
        const align = cell.node.attributes.get('columnalign');
        const at = x + (widths[i] - content.getOuterBBox().w) * (align === 'right' ? 1 : align === 'center' ? 0.5 : 0);
        end = Math.max(end, lapReach(content, at, 1));
        x += widths[i] + spacing[i + 1];
      });
    }
    return end;
  }
  // the same in math that starts at `at`, whose ems are `scale` of the
  // table's: in groups, as the TeXAtom around \rlap's box, and in a table,
  // as a split in an equation. A child starts after the space before it
  // (L, as an operator's lspace) and is followed by the space after it
  // (R). \llap's box, which has an lspace, ends where it stands, and so
  // does the box of \vphantom or \mathstrut, whose mphantom draws nothing.
  function lapReach(wrapper, at, scale) {
    const node = wrapper.node;
    if (node.isKind('mtable')) return at + lapEnd(wrapper, false) * scale;
    if (node.isKind('mpadded')) {
      const content = wrapper.childNodes[0];
      const lapped = String(node.attributes.get('width')) === '0' && !node.attributes.getExplicit('lspace')
        && !content.node.childNodes[0]?.isKind('mphantom');
      return lapped ? at + content.getOuterBBox().w * scale : at;
    }
    if (!['mrow', 'mstyle', 'TeXAtom'].some(kind => node.isKind(kind))) return at;
    let end = at;
    for (const child of wrapper.childNodes) {
      const box = child.getOuterBBox(), childScale = scale * box.rscale;
      end = Math.max(end, lapReach(child, at + box.L * childScale, childScale));
      at += (box.L + box.w + box.R) * childScale;
    }
    return end;
  }
  // a \lefteqn (macros.lua: an mpadded of no width) on a numbered row of
  // an alignment, kept clear of the numbers on a narrow screen. MathJax
  // sizes the table by its columns, so the content of the box may run past
  // the table's right edge, under the number. The table gets that much
  // more room on its right. It stays centered while there is room, as in
  // the PDF, and is moved left when there is not (internal: the wrappers'
  // boxes, the table's spacing, and handleDisplay, which gives a numbered
  // table its width). A row without a number may run into the margin, as
  // in the PDF. A table as wide as the line, as in flalign and multline,
  // is left as MathJax sets it, with its columns spread over the line as
  // in the PDF.
  function clearNumbers() {
    const Wrapper = MathJax._.output.chtml.Wrappers.math.ChtmlMath.prototype;
    const handleDisplay = Wrapper.handleDisplay;
    Wrapper.handleDisplay = function (parent) {
      handleDisplay.call(this, parent);
      const table = this.jax.table;
      if (!table?.hasLabels || table.node.attributes.get('data-width-includes-label')) return;
      const over = lapEnd(table, true) - table.getBBox().w;
      if (over <= 0) return;
      const {L, w, R} = table.getOuterBBox();
      const adaptor = this.adaptor, mtable = table.dom[0], inner = adaptor.firstChild(mtable);
      adaptor.setStyle(mtable, 'min-width', table.em(L + w + over + R));
      // The left margin places the table: centered, or far enough left for
      // the content and the numbers. The right margin keeps that room in
      // an equation's preview, which sets the left margin to 0.
      adaptor.setStyle(mtable, 'text-align', 'left');
      adaptor.setStyle(inner, 'margin-left', `clamp(${table.em(L)}, (100% - ${table.em(w)}) / 2, 100% - ${table.em(w + over + R)})`);
      adaptor.setStyle(inner, 'margin-right', table.em(over + R));
    };
  }

  // \color[model]{values}: MathJax's color extension knows the models rgb,
  // RGB, and gray. Once it has loaded, xcolor's HTML, Gray, cmy, and cmyk
  // are added, converted to RGB as xcolor does (internal: the extension's
  // ColorModel, whose models are private to it, and its TexError).
  const decimal = max => v => /^(\d+(\.\d*)?|\.\d+)$/.test(v) && v <= max;
  const colorModels = {
    HTML: {count: 1, valid: v => /^[0-9A-Fa-f]{6}$/.test(v),
      rgb: ([hex]) => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)},
    Gray: {count: 1, valid: decimal(15), rgb: ([g]) => [g / 15, g / 15, g / 15]},
    cmy: {count: 3, valid: decimal(1), rgb: ([c, m, y]) => [1 - c, 1 - m, 1 - y]},
    cmyk: {count: 4, valid: decimal(1), rgb: ([c, m, y, k]) => [c, m, y].map(x => 1 - Math.min(1, +x + +k))},
  };
  loader['[tex]/color'] = {...loader['[tex]/color'], ready: addColorModels};
  function addColorModels() {
    const {ColorModel} = MathJax._.input.tex.color.ColorUtil;
    const TexError = MathJax._.input.tex.TexError.default;
    const normalizeColor = ColorModel.prototype.normalizeColor;
    ColorModel.prototype.normalizeColor = function (model, value) {
      const spec = colorModels[model];
      if (!spec) return normalizeColor.call(this, model, value);
      const values = value.trim().split(/\s*,\s*/);
      if (values.length !== spec.count || !values.every(spec.valid)) {
        throw new TexError('BadColorValue', 'Invalid color values for the %1 model', model);
      }
      const bytes = spec.rgb(values).map(x => Math.round(255 * x).toString(16).padStart(2, '0'));
      return '#' + bytes.join('');
    };
  }

  // MathJax's default space between rows (in its ems, in which 1pt is
  // 0.1em), and TeX's struts and space, for each environment.
  // tex8web-math.tex lists the environments it numbers.
  const alignment = {rowspacing: 0.3, stretch: 1, space: tex.jot};
  // In arrays and matrices, \arraycolsep is on each side of a column
  // (colsep), and also at an array's edges (edges).
  const matrix = {rowspacing: 0.4, stretch: 1, space: 0, colsep: true};
  const array = {...matrix, edges: true};
  // mathtools' cases environments set rows on struts with \jot between
  // them, as an alignment does. Their \quad starts the second column, so
  // it is there only when a row has a second cell, as in MathJax
  // (mathtools.sty, \MT_start_cases:nnnn).
  const mathtoolsCases = {...alignment, rowspacing: 0.2};
  const environments = {
    align: alignment, 'align*': alignment, alignat: alignment, 'alignat*': alignment,
    flalign: alignment, 'flalign*': alignment, gather: alignment, 'gather*': alignment,
    aligned: alignment, alignedat: alignment, gathered: alignment, split: alignment,
    // LaTeX's eqnarray sets its rows a \baselineskip and \jot apart
    // (\@xeqncr, latex.ltx)
    eqnarray: alignment, 'eqnarray*': alignment,
    multline: {...alignment, rowspacing: 0.5}, 'multline*': {...alignment, rowspacing: 0.5},
    array: array, matrix: matrix, pmatrix: matrix, bmatrix: matrix, Bmatrix: matrix,
    vmatrix: matrix, Vmatrix: matrix,
    'matrix*': matrix, 'pmatrix*': matrix, 'bmatrix*': matrix, 'Bmatrix*': matrix,
    'vmatrix*': matrix, 'Vmatrix*': matrix,
    // amsmath's cases sets \arraystretch to 1.2, and has two columns a
    // \quad apart, also when the second is empty
    cases: {rowspacing: 0.2, stretch: 1.2, space: 0, columns: 2},
    'cases*': mathtoolsCases, dcases: mathtoolsCases, 'dcases*': mathtoolsCases,
    rcases: mathtoolsCases, 'rcases*': mathtoolsCases,
    drcases: mathtoolsCases, 'drcases*': mathtoolsCases,
  };

  // the environment of each table, which MathJax does not record (an
  // mtable's data-latex holds its source with macros expanded): the
  // environments' functions are wrapped to mark the tables they make
  function markEnvironments(parseOptions) {
    // internal: the environment handlers, and their functions
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
  // above and below the baseline, with TeX's space between rows, plus any
  // \\[..]
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

  // TeX's \arraycolsep where MathJax has its 0.5em on each side of a
  // column: 1em between columns, 0.5em at a !{} column, and 0.5em at an
  // array's edges, written as data-array-padding only where an edge has
  // @{}. An @{} column is a column of its own, with 0 around it, so the
  // space that the source sets is kept.
  function spaceColumns(mtable, env) {
    const sep = {'1em': 2 * tex.arraycolsep, '.5em': tex.arraycolsep};
    const space = list => String(list).split(/\s+/)
      .map(s => s in sep ? sep[s].toFixed(3) + 'em' : s).join(' ');
    mtable.attributes.set('columnspacing', space(mtable.attributes.get('columnspacing')));
    if (env.edges) {
      const padding = mtable.attributes.getExplicit('data-array-padding') ?? '.5em .5em';
      mtable.attributes.set('data-array-padding', space(padding));
    }
  }

  // colors (\color, \colorbox, \fcolorbox: mathcolor, mathbackground, and a
  // border in style) at another lightness in dark mode (css/tex8web.css's
  // --tex8web-dark-*). Black text takes the text's color.
  const lightDark = (color, property) =>
    `light-dark(${color}, oklch(from ${color} var(--tex8web-dark-${property}) c h))`;
  const text = color => /^(black|#000000)$/i.test(color) ? 'var(--tex8web-text)' : lightDark(color, 'color');
  function darken(node) {
    const color = node.attributes.getExplicit('mathcolor');
    if (color) node.attributes.set('mathcolor', text(color));
    // \rule is an mspace with a background, drawn in the text's color
    const background = node.attributes.getExplicit('mathbackground');
    if (background) {
      node.attributes.set('mathbackground',
        node.isKind('mspace') ? text(background) : lightDark(background, 'background'));
    }
    const style = node.attributes.getExplicit('style');
    if (style?.startsWith('border: ')) {
      node.attributes.set('style', style.replace(/^(border: \S+ solid )([^;]+)/,
        (_, border, color) => border + lightDark(color, 'border')));
    }
  }

  const bars = ['|', '‖', '∥'];
  const wideAccents = ['^', '~'];
  let TEXCLASS;

  // \mathclap or \clap around a whole display, or around the one cell of a
  // numbered row (mathtools.js: an mpadded of no width, moved left by half
  // its content), given its content's width. The content is centered in
  // the display as in the PDF, and one wider than the column starts at the
  // display's left edge, where it can be scrolled to. A clap inside a
  // larger formula keeps its zero width.
  function unclap(node) {
    for (;;) {
      if (node.isKind('mlabeledtr') && node.childNodes.length === 2) node = node.childNodes[1];
      else if (node.childNodes.length === 1
          && ['math', 'mrow', 'TeXAtom', 'mstyle', 'mtable', 'mtr', 'mtd'].some(kind => node.isKind(kind))) node = node.childNodes[0];
      else break;
    }
    if (node.isKind('mpadded') && String(node.attributes.getExplicit('width')) === '0'
        && node.attributes.getExplicit('lspace') === '-.5width') {
      node.attributes.unset('width');
      node.attributes.unset('lspace');
    }
  }

  function adjust({math, data}) {
    if (math.display) unclap(data.root);
    const factory = data.nodeFactory;
    const scale = (100 * tex.exscale).toFixed(1) + '%';
    const operators = [];
    data.root.walkTree(node => {
      darken(node);
      if (node.isKind('mtable')) {
        const env = environment(node);
        if (env) spaceRows(node, env, factory);
        if (env?.colsep) spaceColumns(node, env);
      } else if (node.isKind('mspace') && !math.display && node.attributes.getExplicit('width')
          && !node.attributes.getExplicit('linebreak')) {
        // inline math never breaks at a space, such as the \, between a
        // number and its unit, as TeX never breaks a formula at glue
        // (\allowbreak is a space without a width)
        node.attributes.set('linebreak', 'nobreak');
      } else if (node.isKind('mo')) {
        // inline math breaks after a relation or binary operator, as in TeX
        if (node.texClass === TEXCLASS.REL || node.texClass === TEXCLASS.BIN) {
          node.attributes.set('linebreakstyle', 'after');
        }
        const minsize = node.attributes.getExplicit('minsize');
        if (node.getProperty('mathaccent') && wideAccents.includes(node.getText())
            && node.attributes.getExplicit('stretchy') !== false) {
          // \widehat and \widetilde: the widest of TeX's sizes (0.556, 1,
          // and 1.444em) not wider than the base, or else the narrowest.
          // Internal, getStretchedVariant: an accent takes the size before
          // the first one at least as wide as its base, that width clamped
          // to minsize and maxsize, hence bounds a little above 0.556 and
          // 1.444em. Without them, MathJax aims wider than the base, among
          // sizes from \hat's 0.5em to 1.889em.
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
    // large operators: scaled by an mstyle around them, because MathJax
    // misplaces the limits of \int (tucked into its slant) when the <mo>
    // itself is scaled
    for (const mo of operators) {
      const parent = mo.parent;
      const style = factory.create('node', 'mstyle', [], {mathsize: scale});
      parent.replaceChild(style, mo);
      style.childNodes[0].appendChild(mo);
    }
  }

  // the parts of an alignment split at \intertext (tex8web-math.tex), each a
  // formula with \webalignment{n} at its start: the same columns in each,
  // each column as wide as in its widest part, so the parts line up as
  // TeX's one alignment does
  function markAlignment(math) {
    math.math = math.math.replace(/\\webalignment\s*\{(\d+)\}/, (_, n) => {
      math.tex8webAlignment = n;
      // internal: ui/lazy's flags, which would leave the formula uncompiled
      // until it is in view
      math.lazyCompile = math.lazyTypeset = false;
      return '';
    });
  }
  function markAlignments(doc) {
    for (const math of doc.math) markAlignment(math);
  }
  // the top table of a part (none if MathJax could not parse it), and its
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
      // once per compiled formula: ui/lazy and the menu render the page
      // again, and the widths would then be the ones set here
      if (parts.every(math => math.root.getProperty('tex8web-columns'))) continue;
      parts.forEach(math => math.root.setProperty('tex8web-columns', true));
      const tables = parts.map(math => measure(math, doc)).filter(Boolean);
      if (!tables.length) continue;
      const widths = [];
      for (const table of tables) {
        table.widths.forEach((width, i) => { widths[i] = Math.max(widths[i] || 0, width); });
      }
      // A part with fewer columns gets the columns of the part with the
      // most, with their spacing and alignment, which MathJax sets per
      // table. flalign's spacers stay as wide as the room left.
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
        // rounded up, so that a cell's content fits
        node.attributes.set('columnwidth', widths.map((w, i) =>
          given[i] === 'fit' ? 'fit' : Math.ceil(w * 1000) / 1000 + 'em').join(' '));
      }
    }
  }

  // in the options, as the menu may make the document anew: before compile
  // (20), and after the metrics (110), which the widths need
  const options = config.options = config.options || {};
  options.renderActions = {
    ...options.renderActions,
    tex8webAlignment: [15, markAlignments, markAlignment],
    tex8webColumns: [115, alignColumns, () => {}],
  };

  // macros.lua's definitions (the page's #tex8web-macros, as text), given
  // to MathJax before any math, which ui/lazy may typeset in any order
  // (internal: ui/lazy compiles math without a node, such as tex2mml's, at
  // once). Given as a promise, because a \definecolor loads the color
  // extension. A TeX error in one definition leaves the ones after it
  // undefined.
  const pageReady = startup.pageReady;
  startup.pageReady = async function () {
    const doc = MathJax.startup.document;
    const [macros] = doc.adaptor.getElements(['#tex8web-macros'], doc.document);
    const mml = macros ? await MathJax.tex2mmlPromise(doc.adaptor.textContent(macros)) : '';
    if (mml.includes('<merror')) console.warn('tex8web: a TeX error in a macro definition:', mml);
    return pageReady ? pageReady() : MathJax.startup.defaultPageReady();
  };

  // \text, \mbox, and \hbox in text, as in \text{\text{E}},
  // \textbf{\text{E}}, \text{a \mbox{b}}, or a macro whose body is one of
  // them used in \text: LaTeX sets the argument in the font around it.
  // MathJax's textmacros reads the argument of \text as text, where these
  // are "only supported in math mode". tex8web-text gives them there as
  // groups (internal: textmacros' Macro method, and the Configuration and
  // CommandMap of a package).
  const texOptions = config.tex = config.tex || {};
  const textmacros = texOptions.textmacros = texOptions.textmacros || {};
  textmacros.packages = {'[+]': ['tex8web-text']};
  function addTextInText() {
    const {Configuration} = MathJax._.input.tex.Configuration;
    const {CommandMap} = MathJax._.input.tex.TokenMap;
    const {TextMacrosMethods} = MathJax._.input.tex.textmacros.TextMacrosMethods;
    const group = [TextMacrosMethods.Macro, '{#1}', 1];
    new CommandMap('tex8web-text', {text: group, mbox: group, hbox: group});
    Configuration.create('tex8web-text', {parser: 'text', handler: {macro: ['tex8web-text']}});
  }

  // \hidewidth: a cell narrower than its column goes to the side away from
  // it, as in the PDF, where its fill glue is stronger than the column's
  // \hfil. MathJax's \hfill does this at a cell's start or end (internal:
  // an ArrayItem's hfill, read when the cell ends), but is an error outside
  // a table. A style command, such as \scriptstyle or the \displaystyle of
  // a column's template, opens a StyleItem over the cell that closes only
  // when the cell ends, into one mstyle. Under such items, \hidewidth is
  // at the cell's start when they and the cell are empty, and at its end
  // when nothing follows it in them: each item notes, when it closes,
  // whether \hidewidth ends it, for the item below.
  const packages = texOptions.packages = texOptions.packages || {};
  (packages['[+]'] = packages['[+]'] || []).push('tex8web-hidewidth');
  function addHidewidth() {
    const {Configuration} = MathJax._.input.tex.Configuration;
    const {CommandMap} = MathJax._.input.tex.TokenMap;
    const {ArrayItem, StyleItem} = MathJax._.input.tex.base.BaseItems;
    new CommandMap('tex8web-hidewidth', {hidewidth(parser) {
      const styles = [];
      let item = parser.stack.Top();
      while (item instanceof StyleItem) {
        styles.push(item);
        item = parser.stack.Top(styles.length + 1);
      }
      if (!(item instanceof ArrayItem)) return;
      if (!styles.length) {
        item.hfill.push(item.Size());
        return;
      }
      if (!item.Size() && styles.every(style => !style.Size())) item.hfill.push(0);
      styles.forEach((style, i) => style.hidewidthBelow = styles[i + 1] || item);
      styles[0].hidewidthEnd = styles[0].Size();
    }});
    const checkItem = StyleItem.prototype.checkItem;
    StyleItem.prototype.checkItem = function (item) {
      const below = this.hidewidthBelow;
      if (item.isClose && below && this.hidewidthEnd === this.Size()) {
        if (below instanceof ArrayItem) below.hfill.push(below.Size() + 1);
        else below.hidewidthEnd = below.Size() + 1;
      }
      return checkItem.call(this, item);
    };
    Configuration.create('tex8web-hidewidth', {handler: {macro: ['tex8web-hidewidth']}});
  }

  // mathjax-modern (Latin Modern Math) with the PDF's \mathbb, \mathcal, and
  // accents. \mathbb takes New Computer Modern's double-struck capitals,
  // drawn as AMS's msbm, and \mathcal the TeX font's calligraphic capitals,
  // with cmsy10's widths. mathjax-modern 4.1.3 has wrong skews and
  // combining offsets (dx), which place accents (a skew of 0.303em on the
  // italic a, where TeX has 0.022em). Both come from New Computer Modern,
  // whose data is in tex-chtml.js, for each character of the same width. The metrics are those of the 4.1.3 fonts.
  // Added as font extensions, as MathJax's dsfont extension does, to the
  // font class, before MathJax makes the font (internal: the class, its
  // dynamic files, and AddFontIds).
  function matchModernFont() {
    const Font = MathJax._.output.fonts?.['mathjax-modern']?.chtml_ts.MathJaxModernFont;
    if (!Font) return;
    const {AddFontIds} = MathJax._.output.chtml.DynamicFonts;
    const {Package} = MathJax._.components.package;
    const newcm = MathJax._.output.chtml.DefaultFont.DefaultFont.defaultChars;
    const skewed = {};
    for (const [variant, chars] of Object.entries(Font.defaultChars)) {
      for (const [n, char] of Object.entries(chars)) {
        const other = newcm[variant]?.[n];
        if (!Array.isArray(char) || !Array.isArray(other) || char[2] !== other[2]) continue;
        const {sk = 0, dx = 0} = other[3] || {};
        if ((char[3]?.sk || 0) === sk && (char[3]?.dx || 0) === dx) continue;
        (skewed[variant] = skewed[variant] || {})[n] = [...char.slice(0, 3), {...char[3], sk, dx}];
      }
    }
    // the path of the modern font with another name: on a CDN, it has
    // MathJax's version
    const url = name => Package.resolvePath(
      MathJax.config.loader.paths['mathjax-modern'].replace('modern', name) + '/chtml/woff2', false);
    const doubleStruck = {
      0x1D538: [.704, 0, .722, {sk: -.014}], 0x1D539: [.685, 0, .666], 0x2102: [.704, .019, .722, {sk: .036}],
      0x1D53B: [.685, 0, .722, {sk: -.02}], 0x1D53C: [.685, 0, .666], 0x1D53D: [.685, 0, .611, {sk: .03}],
      0x1D53E: [.704, .019, .777], 0x210D: [.685, 0, .777, {sk: .011}], 0x1D540: [.685, 0, .388],
      0x1D541: [.685, .075, .5, {sk: .055}], 0x1D542: [.685, 0, .777, {sk: .015}], 0x1D543: [.685, 0, .666, {sk: -.148}],
      0x1D544: [.685, 0, .944, {sk: .073}], 0x2115: [.685, .019, .722, {sk: .022}], 0x1D546: [.704, .019, .777],
      0x2119: [.685, 0, .611, {sk: .028}], 0x211A: [.704, .179, .777], 0x211D: [.685, 0, .722],
      0x1D54A: [.704, .012, .555, {sk: -.013}], 0x1D54B: [.685, 0, .666], 0x1D54C: [.685, .019, .722, {sk: .053}],
      0x1D54D: [.685, .019, .722, {sk: .072}], 0x1D54E: [.685, .019, 1, {sk: .048}], 0x1D54F: [.685, 0, .722, {sk: .026}],
      0x1D550: [.685, 0, .722, {sk: .038}], 0x2124: [.685, 0, .666, {sk: .057}],
    };
    const calligraphic = {
      0x41: [.728, .05, .798, {ic: .021, sk: .274}], 0x42: [.705, .022, .657, {ic: .007, sk: .09}],
      0x43: [.705, .025, .527, {ic: .006, sk: .135}], 0x44: [.683, 0, .771, {sk: .06}],
      0x45: [.705, .022, .528, {ic: .036, sk: .143}], 0x46: [.683, .032, .719, {ic: .11, sk: .266}],
      0x47: [.704, .119, .595, {ic: .004, sk: .164}], 0x48: [.683, .048, .845, {sk: .163}],
      0x49: [.683, 0, .545, {ic: .097, sk: .159}], 0x4A: [.683, .119, .678, {ic: .161, sk: .219}],
      0x4B: [.705, .022, .762, {sk: .173}], 0x4C: [.705, .022, .69, {sk: .249}],
      0x4D: [.705, .05, 1.201, {sk: .128}], 0x4E: [.789, .05, .82, {ic: .159, sk: .121}],
      0x4F: [.705, .022, .796, {sk: .166}], 0x50: [.683, .057, .696, {ic: .037, sk: .099}],
      0x51: [.705, .131, .817, {sk: .124}], 0x52: [.682, .022, .848, {sk: .123}],
      0x53: [.705, .022, .606, {ic: .036, sk: .139}], 0x54: [.717, .068, .545, {ic: .288, sk: .112}],
      0x55: [.683, .028, .626, {ic: .061, sk: .06}], 0x56: [.683, .052, .613, {ic: .045, sk: .042}],
      0x57: [.683, .055, .988, {ic: .046, sk: .035}], 0x58: [.683, 0, .713, {ic: .094, sk: .121}],
      0x59: [.683, .143, .668, {ic: .046, sk: .083}], 0x5A: [.683, 0, .725, {ic: .042, sk: .033}],
    };
    const boldCalligraphic = {
      0x41: [.751, .049, .921, {ic: .068, sk: .283}], 0x42: [.705, .017, .748, {sk: .101}],
      0x43: [.703, .02, .613, {sk: .15}], 0x44: [.686, 0, .892, {sk: .045}],
      0x45: [.703, .016, .607, {ic: .02, sk: .151}], 0x46: [.686, .03, .814, {ic: .116, sk: .151}],
      0x47: [.703, .113, .682, {sk: .177}], 0x48: [.686, .048, .987, {sk: .178}],
      0x49: [.686, 0, .642, {ic: .104, sk: .199}], 0x4A: [.686, .114, .779, {ic: .158, sk: .26}],
      0x4B: [.703, .017, .871, {sk: .196}], 0x4C: [.703, .017, .788, {sk: .259}],
      0x4D: [.703, .049, 1.378, {sk: .115}], 0x4E: [.84, .049, .937, {ic: .168, sk: .139}],
      0x4F: [.703, .017, .906, {sk: .183}], 0x50: [.686, .067, .81, {ic: .036, sk: .126}],
      0x51: [.703, .146, .939, {sk: .138}], 0x52: [.686, .017, .99, {sk: .133}],
      0x53: [.703, .016, .696, {ic: .025, sk: .141}], 0x54: [.72, .069, .644, {ic: .303, sk: .144}],
      0x55: [.686, .024, .715, {ic: .056, sk: .07}], 0x56: [.686, .077, .737, {ic: .037, sk: .035}],
      0x57: [.686, .077, 1.169, {ic: .037, sk: .057}], 0x58: [.686, -.001, .817, {ic: .089, sk: .125}],
      0x59: [.686, .164, .759, {ic: .038, sk: .079}], 0x5A: [.686, 0, .818, {ic: .035, sk: .133}],
    };
    Font.addExtension({name: 'tex8web-skews', chars: skewed});
    Font.addExtension({name: 'tex8web-newcm', fonts: ['MJX-NCM-DS'], fontURL: url('newcm'),
      chars: AddFontIds({DS: {'double-struck': doubleStruck}}, 'NCM')});
    // the font's dynamic file of calligraphic letters would otherwise set
    // its letters over these, when first used
    delete Font.dynamicFiles.calligraphic;
    Font.addExtension({name: 'tex8web-tex', fonts: ['MJX-TEX-C', 'MJX-TEX-CB'], fontURL: url('tex'),
      chars: AddFontIds({C: {'-tex-calligraphic': calligraphic}, CB: {'-tex-bold-calligraphic': boldCalligraphic}}, 'TEX')});
  }

  const ready = startup.ready;
  startup.ready = function () {
    addTextInText();
    addHidewidth();
    sizeBigDelimiters();
    fixRowHeights();
    clearNumbers();
    matchModernFont();
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
  // MathJax's TeX extensions with separate fonts (bbm and co.) load the
  // fonts from jsDelivr without a version, unlike MathJax's font, so a later
  // release of them would change the page. They are pinned to MathJax's
  // version, which page.lua gives this script. The extensions set the paths
  // only if they are not set.
  const version = document.currentScript.dataset.mathjax;
  const paths = data.mathjax.loader.paths = data.mathjax.loader.paths || {};
  for (const name of ['bbm', 'bboldx', 'dsfont', 'mhchem']) {
    paths[`mathjax-${name}-extension`] = `https://cdn.jsdelivr.net/npm/@mathjax/mathjax-${name}-font-extension@${version}`;
  }
  window.MathJax = tex8web(data.mathjax, data.tex);
  // an option of ui/lazy, which prerender.mjs leaves out: the math in the
  // table of contents is typeset at once, because the bar on a phone copies
  // the entry being read. Set only on a page with a table of contents,
  // which page.lua marks: ui/lazy 4.1.3 fails on a selector that matches
  // nothing.
  if ('contents' in document.currentScript.dataset) window.MathJax.options.lazyAlwaysTypeset = '.tex8web-toc';
}
