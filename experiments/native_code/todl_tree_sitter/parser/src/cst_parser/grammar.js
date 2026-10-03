module.exports = grammar({
  name: "cst_todl",

  word: $ => $.identifier,

  extras: $ => [
    /\s/,
    $.comment,
  ],

  rules: {
    source_file: $ => $.namespace_definition,

    namespace_definition: $ => seq(
      "namespace",
      $.dotted_path,
      "{",
      repeat($.import_statement),
      repeat($.declaration),
      "}",
    ),

    import_statement: $ => seq("import", $.dotted_path, ";"),

    declaration: $ => seq(
      repeat(choice("internal", "sealed")),
      choice(
        $.primitive_declaration,
        $.taxonomy_declaration,
        $.viewpoint_declaration,
        $.concept_declaration,
        $.model_declaration,
        $.annotation_declaration,
        $.package_declaration,
        $.operator_declaration,
        $.class_declaration,
        $.instance_declaration,
      ),
    ),

    primitive_declaration: $ => seq(
      "primitive",
      $.identifier,
      optional(seq(":", $.identifier)),
      "{",
      repeat($.string_member),
      "}",
    ),

    taxonomy_declaration: $ => seq(
      "taxonomy",
      $.identifier,
      ":",
      "represents",
      $.dotted_path,
      repeat(seq(",", $.dotted_path)),
      optional(seq("uses", $.dotted_path, repeat(seq(",", $.dotted_path)))),
      "{",
      repeat(choice(
        $.term_declaration,
        $.concept_term_declaration,
        $.annotation_application,
        $.string_member,
      )),
      "}",
    ),

    term_declaration: $ => seq("term", $.identifier, $.term_body),

    concept_term_declaration: $ => seq($.identifier, $.identifier, $.term_body),

    term_body: $ => seq(
      "{",
      repeat(choice(
        $.term_declaration,
        $.concept_term_declaration,
        $.assignment,
        $.annotation_application,
      )),
      "}",
    ),

    viewpoint_declaration: $ => seq(
      "viewpoint",
      $.identifier,
      ":",
      "frames",
      $.dotted_path,
      repeat(seq(",", $.dotted_path)),
    ),

    concept_declaration: $ => seq(
      "concept",
      $.identifier,
      optional(seq(":", $.dotted_path)),
      "{",
      repeat(choice(
        $.field_declaration,
        $.relationship_declaration,
        $.invariant_declaration,
        $.annotation_application,
        $.authoring_block,
        $.doc_assignment,
      )),
      "}",
    ),

    field_declaration: $ => seq($.identifier, ":", $.dotted_path, optional($.cardinality), ";"),

    relationship_declaration: $ => seq(
      "relationship",
      $.identifier,
      "->",
      $.dotted_path,
      repeat(seq("|", $.dotted_path)),
      optional($.cardinality),
      choice(";", seq("{", repeat($.annotation_application), "}")),
    ),

    invariant_declaration: $ => choice(
      seq("invariant", $.string, ";"),
      seq("invariant", "{", repeat(choice($.predicate_member, $.invariant_string_member)), "}"),
    ),

    predicate_member: $ => seq("predicate", "=", repeat($.predicate_token), ";"),

    invariant_string_member: $ => seq($.identifier, "=", choice($.string, $.raw_string), ";"),

    authoring_block: $ => seq("authoring", $.identifier, "{", repeat($.doc_assignment), "}"),

    model_declaration: $ => seq(
      "model",
      $.identifier,
      ":",
      $.dotted_path,
      optional(seq("uses", $.dotted_path, repeat(seq(",", $.dotted_path)))),
      optional(seq("conforms", $.dotted_path)),
      "{",
      repeat(choice($.instance_declaration, $.edge_statement, $.annotation_application)),
      "}",
    ),

    annotation_declaration: $ => seq(
      "annotation",
      $.identifier,
      optional(seq(":", $.dotted_path)),
      "{",
      repeat($.field_declaration),
      "}",
    ),

    annotation_application: $ => seq("annotate", $.dotted_path, "{", repeat($.assignment), "}"),

    package_declaration: $ => seq("package", "{", repeat($.annotation_application), "}"),

    operator_declaration: $ => seq(
      "operator",
      $.symbol_operator,
      ":",
      $.dotted_path,
      optional(seq("(", $.identifier, ",", $.identifier, ")")),
      ";",
    ),

    class_declaration: $ => seq(
      "class",
      $.identifier,
      $.record_id,
      optional(seq("instanceof", $.dotted_path)),
      optional(seq(":", $.identifier)),
      $.record_body,
    ),

    instance_declaration: $ => seq(
      $.dotted_path,
      $.record_id,
      optional(seq("instanceof", $.dotted_path)),
      optional(seq(":", $.identifier)),
      $.record_body,
    ),

    nested_instance: $ => seq(
      $.identifier,
      $.record_id,
      optional(seq("instanceof", $.dotted_path)),
      optional(seq(":", $.identifier)),
      $.record_body,
    ),

    record_body: $ => seq(
      "{",
      repeat(choice($.assignment, $.nested_instance, $.edge_statement, $.annotation_application)),
      "}",
    ),

    assignment: $ => seq($.identifier, "=", $.value, ";"),

    doc_assignment: $ => seq($.identifier, "=", $.doc_value, ";"),

    string_member: $ => seq($.identifier, "=", $.value, ";"),

    edge_statement: $ => seq(
      $._edge_expression,
      choice(";", seq($.edge_body, optional(";"))),
    ),

    _edge_expression: $ => seq($.dotted_path, $.symbol_operator, $.dotted_path),

    edge_body: $ => seq("{", repeat($.assignment), "}"),

    value: $ => choice(
      $.string,
      $.raw_string,
      $.number,
      $.boolean,
      $.list_value,
      $.inline_object,
      $.value_edge,
      $.composite_name,
      $.dotted_path,
    ),

    value_edge: $ => seq($._edge_expression, optional($.edge_body)),

    inline_object: $ => seq($.dotted_path, $.record_body),

    list_value: $ => seq(
      "[",
      optional(seq($.value, repeat(seq(",", $.value)), optional(","))),
      "]",
    ),

    composite_name: $ => seq($.identifier, "|", $.identifier, repeat(seq("|", $.identifier))),

    boolean: $ => choice("true", "false"),

    dotted_path: $ => seq($.identifier, repeat(seq(".", $.identifier))),

    cardinality: $ => choice("?", "[]", "[+]"),

    record_id: $ => choice($.identifier, $.string, $.raw_string),

    doc_value: $ => choice($.value, $.symbol_operator, "&", "&&", "||", ":"),

    predicate_token: $ => choice(
      $.identifier,
      $.number,
      $.string,
      $.raw_string,
      $.symbol_operator,
      "&&",
      "||",
      "&",
      "|",
      "?",
      "+",
      "*",
      ".",
      ":",
      "(",
      ")",
      "[",
      "]",
      "{",
      "}",
    ),

    identifier: _ => /[A-Za-z_][A-Za-z0-9_]*/,

    number: _ => /[0-9]+(\.[0-9]+)?/,

    string: _ => token(/"([^"\\\n]|\\.)*"/),

    raw_string: _ => token(/"""[\s\S]*?"""/),

    symbol_operator: _ => token(prec(1, choice(
      /[-~><!][-~=><!]*/,
      /=[-~=><!]+/,
    ))),

    comment: _ => token(choice(
      seq("//", /[^\n]*/),
      seq("/*", /[\s\S]*?/, "*/"),
    )),
  },
});
