module.exports = grammar({
  name: "ast_todl",

  word: $ => $.identifier,

  extras: $ => [
    /\s/,
    $.comment,
  ],

  rules: {
    source_file: $ => $.namespace_definition,

    namespace_definition: $ => seq(
      "namespace",
      field("path", $.dotted_path),
      "{",
      repeat(field("imports", $.import_statement)),
      repeat(field("declarations", $._declaration)),
      "}",
    ),

    import_statement: $ => seq("import", field("path", $.dotted_path), ";"),

    _declaration: $ => seq(
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
      field("name", $.identifier),
      optional(seq(":", field("base", $.identifier))),
      "{",
      repeat(field("members", $.string_member)),
      "}",
    ),

    taxonomy_declaration: $ => seq(
      "taxonomy",
      field("name", $.identifier),
      ":",
      "represents",
      field("represented_concepts", $.dotted_path),
      repeat(seq(",", field("represented_concepts", $.dotted_path))),
      optional(seq(
        "uses",
        field("uses", $.dotted_path),
        repeat(seq(",", field("uses", $.dotted_path))),
      )),
      "{",
      repeat(choice(
        field("terms", $.term_declaration),
        field("terms", $.concept_term_declaration),
        field("annotations", $.annotation_application),
        field("members", $.string_member),
      )),
      "}",
    ),

    term_declaration: $ => seq(
      "term",
      field("id", $.identifier),
      field("body", $.term_body),
    ),

    concept_term_declaration: $ => seq(
      field("concept", $.identifier),
      field("id", $.identifier),
      field("body", $.term_body),
    ),

    term_body: $ => seq(
      "{",
      repeat(choice(
        field("children", $.term_declaration),
        field("children", $.concept_term_declaration),
        field("assignments", $.assignment),
        field("annotations", $.annotation_application),
      )),
      "}",
    ),

    viewpoint_declaration: $ => seq(
      "viewpoint",
      field("name", $.identifier),
      ":",
      "frames",
      field("frames", $.dotted_path),
      repeat(seq(",", field("frames", $.dotted_path))),
    ),

    concept_declaration: $ => seq(
      "concept",
      field("name", $.identifier),
      optional(seq(":", field("extends", $.dotted_path))),
      "{",
      repeat(choice(
        field("fields", $.field_declaration),
        field("relationships", $.relationship_declaration),
        field("invariants", $.invariant_declaration),
        field("annotations", $.annotation_application),
        field("authoring", $.authoring_block),
        field("members", $.doc_assignment),
      )),
      "}",
    ),

    field_declaration: $ => seq(
      field("name", $.identifier),
      ":",
      field("type", $.dotted_path),
      optional(field("cardinality", $.cardinality)),
      ";",
    ),

    relationship_declaration: $ => seq(
      "relationship",
      field("name", $.identifier),
      "->",
      field("targets", $.dotted_path),
      repeat(seq("|", field("targets", $.dotted_path))),
      optional(field("cardinality", $.cardinality)),
      choice(
        ";",
        seq("{", repeat(field("annotations", $.annotation_application)), "}"),
      ),
    ),

    invariant_declaration: $ => choice(
      seq("invariant", field("description", $.string), ";"),
      seq(
        "invariant",
        "{",
        repeat(choice(
          field("predicate", $.predicate_member),
          field("members", $.invariant_string_member),
        )),
        "}",
      ),
    ),

    predicate_member: $ => seq(
      "predicate",
      "=",
      repeat(field("tokens", $.predicate_token)),
      ";",
    ),

    invariant_string_member: $ => seq(
      field("name", $.identifier),
      "=",
      field("value", choice($.string, $.raw_string)),
      ";",
    ),

    authoring_block: $ => seq(
      "authoring",
      field("name", $.identifier),
      "{",
      repeat(field("members", $.doc_assignment)),
      "}",
    ),

    model_declaration: $ => seq(
      "model",
      field("id", $.identifier),
      ":",
      field("meta_model", $.dotted_path),
      optional(seq(
        "uses",
        field("libraries", $.dotted_path),
        repeat(seq(",", field("libraries", $.dotted_path))),
      )),
      optional(seq("conforms", field("conforms", $.dotted_path))),
      "{",
      repeat(choice(
        field("instances", $.instance_declaration),
        field("edges", $.edge_statement),
        field("annotations", $.annotation_application),
      )),
      "}",
    ),

    annotation_declaration: $ => seq(
      "annotation",
      field("name", $.identifier),
      optional(seq(":", field("extends", $.dotted_path))),
      "{",
      repeat(field("parameters", $.field_declaration)),
      "}",
    ),

    annotation_application: $ => seq(
      "annotate",
      field("name", $.dotted_path),
      "{",
      repeat(field("assignments", $.assignment)),
      "}",
    ),

    package_declaration: $ => seq(
      "package",
      "{",
      repeat(field("annotations", $.annotation_application)),
      "}",
    ),

    operator_declaration: $ => seq(
      "operator",
      field("glyph", $.symbol_operator),
      ":",
      field("target", $.dotted_path),
      optional(seq(
        "(",
        field("from_member", $.identifier),
        ",",
        field("to_member", $.identifier),
        ")",
      )),
      ";",
    ),

    class_declaration: $ => seq(
      "class",
      field("concept", $.identifier),
      field("id", $.record_id),
      optional(seq("instanceof", field("instance_of", $.dotted_path))),
      optional(seq(":", field("binds", $.identifier))),
      field("body", $.record_body),
    ),

    instance_declaration: $ => seq(
      field("concept", $.dotted_path),
      field("id", $.record_id),
      optional(seq("instanceof", field("instance_of", $.dotted_path))),
      optional(seq(":", field("binds", $.identifier))),
      field("body", $.record_body),
    ),

    nested_instance: $ => seq(
      field("concept", $.identifier),
      field("id", $.record_id),
      optional(seq("instanceof", field("instance_of", $.dotted_path))),
      optional(seq(":", field("binds", $.identifier))),
      field("body", $.record_body),
    ),

    record_body: $ => seq(
      "{",
      repeat(choice(
        field("assignments", $.assignment),
        field("children", $.nested_instance),
        field("edges", $.edge_statement),
        field("annotations", $.annotation_application),
      )),
      "}",
    ),

    assignment: $ => seq(field("name", $.identifier), "=", field("value", $.value), ";"),

    doc_assignment: $ => seq(field("name", $.identifier), "=", field("value", $.doc_value), ";"),

    string_member: $ => seq(field("name", $.identifier), "=", field("value", $.value), ";"),

    edge_statement: $ => seq(
      $._edge_expression,
      choice(";", seq(field("body", $.edge_body), optional(";"))),
    ),

    _edge_expression: $ => seq(
      field("left", $.dotted_path),
      field("operator", $.symbol_operator),
      field("right", $.dotted_path),
    ),

    edge_body: $ => seq("{", repeat(field("assignments", $.assignment)), "}"),

    value: $ => choice(
      field("string", $.string),
      field("string", $.raw_string),
      field("number", $.number),
      field("boolean", $.boolean),
      field("list", $.list_value),
      field("object", $.inline_object),
      field("edge", $.value_edge),
      field("composite", $.composite_name),
      field("name", $.dotted_path),
    ),

    value_edge: $ => seq($._edge_expression, optional(field("body", $.edge_body))),

    inline_object: $ => seq(field("concept", $.dotted_path), field("body", $.record_body)),

    list_value: $ => seq(
      "[",
      optional(seq(
        field("items", $.value),
        repeat(seq(",", field("items", $.value))),
        optional(","),
      )),
      "]",
    ),

    composite_name: $ => seq(
      field("parts", $.identifier),
      "|",
      field("parts", $.identifier),
      repeat(seq("|", field("parts", $.identifier))),
    ),

    boolean: $ => choice("true", "false"),

    dotted_path: $ => seq(
      field("segments", $.identifier),
      repeat(seq(".", field("segments", $.identifier))),
    ),

    cardinality: $ => choice("?", "[]", "[+]"),

    record_id: $ => choice(
      field("identifier", $.identifier),
      field("string", $.string),
      field("string", $.raw_string),
    ),

    doc_value: $ => choice(
      $.value,
      $.symbol_operator,
      "&",
      "&&",
      "||",
      ":",
    ),

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

function commaSep1(rule)
{
  return seq(rule, repeat(seq(",", rule)));
}

function sep1(rule, separator)
{
  return seq(rule, repeat(seq(separator, rule)));
}
