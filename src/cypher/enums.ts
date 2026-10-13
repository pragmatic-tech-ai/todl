export enum TokenKind
{
    LParen, RParen, LBracket, RBracket, LBrace, RBrace,
    Colon, Comma, Dot, Dollar, Dash, ArrowRight, ArrowLeft,
    Eq, Neq, Lt, Lte, Gt, Gte, Star, Plus, Slash, Percent,
    Identifier, Keyword, String, Number, Eof,
}

export enum RelDirection { Outgoing, Incoming, Undirected }

export enum ComparisonOp { Eq, Neq, Lt, Lte, Gt, Gte }

export enum BooleanOp { And, Or, Not }

export enum ArithmeticOp { Add, Sub, Mul, Div, Mod }
