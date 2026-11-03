export enum TokenKind
{
    LParen, RParen, LBracket, RBracket, LBrace, RBrace,
    Colon, Comma, Dot, Dollar, Dash, ArrowRight, ArrowLeft,
    Eq, Neq, Lt, Lte, Gt, Gte, Star, Plus, PlusEq, Slash, Percent,
    Identifier, Keyword, String, Number, Eof,
}

// Property: SET n.p = v. MergeMap: SET n += {map} (listed props only). Replace: SET n = {map} (listed props, all others removed).
export enum SetMode { Property, MergeMap, Replace }

export enum RelDirection { Outgoing, Incoming, Undirected }

export enum ComparisonOp { Eq, Neq, Lt, Lte, Gt, Gte }

export enum BooleanOp { And, Or, Not }

export enum ArithmeticOp { Add, Sub, Mul, Div, Mod }
