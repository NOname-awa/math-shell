import readline from 'readline';
import Decimal from 'decimal.js';
import esprima from 'esprima';
import chalk from 'chalk';

class MathShell {
    constructor() {
        this.angleMode = 'deg';
        this.commandMode = false;
    }

    /**
     * Parses a mathematical expression using Esprima.
     * @param {string} expression - The expression to parse.
     * @returns {Object} The parsed expression node.
     */
    parseExpression(expression) {
        try {
            return esprima.parseScript(expression);
        } catch (error) {
            throw new SyntaxError(`Syntax Error: ${error.message} in expression "${expression}"`);
        }
    }

    /**
     * Evaluates a parsed expression node.
     * @param {Object} node - The expression node to evaluate.
     * @returns {Decimal} The result of the evaluation.
     * @throws Will throw an error if the node type is unsupported.
     */
    evaluate(node) {
        let self = this;

        function evaluateNode(node) {
            try {
                let result;
                switch (node.type) {
                    case 'Literal':
                        result = new Decimal(node.value);
                        break;
                    case 'BinaryExpression':
                        result = self.OPERATORS[node.operator](evaluateNode(node.left), evaluateNode(node.right));
                        break;
                    case 'UnaryExpression':
                        result = self.OPERATORS[node.operator](evaluateNode(node.argument));
                        break;
                    case 'CallExpression':
                        let func = node.callee.name;
                        if (self.FUNCTIONS[func]) {
                            let arg = evaluateNode(node.arguments[0]);
                            if (self.angleMode === 'deg') {
                                arg = Decimal.acos(-1).mul(arg).div(180);  // Convert degrees to radians
                            }
                            result = self.FUNCTIONS[func](arg);
                        } else {
                            throw new Error(`Unsupported function: ${func}`);
                        }
                        break;
                    default:
                        throw new Error(`Unsupported type: ${node.type}`);
                }
                if (result.isNaN()) {
                    throw new Error(`Error: Result is Not A Number for expression with operator "${node.operator || 'unknown'}"`);
                }
                return result;
            } catch (error) {
                throw new Error(error.message);
            }
        }

        return evaluateNode(node);
    }

    /**
     * Highlights the input expression for better readability.
     * @param {string} input - The input expression to highlight.
     * @returns {string} The highlighted expression.
     */
    highlightInput(input) {
        let highlighted = input
            .replace(/\b(\d+(\.\d+)?)\b/g, chalk.green('$1')) // Highlight numbers
            .replace(/(\+|\-|\*|\/|\%|\*\*|=)/g, chalk.yellow('$1')) // Highlight operators
            .replace(/\b(sin|cos|tan)\b/g, chalk.cyan('$1')); // Highlight functions

        // Highlight parentheses with rainbow colors
        let colorIndex = 0;
        const colors = [chalk.yellow, chalk.hex('#800080'), chalk.blue];
        let stack = [];

        highlighted = highlighted.replace(/[\(\)]/g, (match) => {
            if (match === '(') {
                stack.push(colorIndex);
                let coloredBracket = colors[colorIndex](match);
                colorIndex = (colorIndex + 1) % colors.length;
                return coloredBracket;
            } else if (match === ')') {
                colorIndex = stack.pop();
                return (colors[colorIndex] ?? chalk.red)(match);
            }
            return match;
        });

        return highlighted;
    }

    /**
     * Runs the interactive shell.
     */
    runShell() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: `${this.angleMode} ‣ `,
            completer: this.completer.bind(this)
        });

        rl.prompt();

        rl.on('line', (line) => {
            let expression = line.trim();
            if (expression === "") {
                this.commandMode = !this.commandMode;
                rl.setPrompt(`${this.angleMode} ${this.commandMode ? '%' : '‣'} `);
                rl.prompt();
                return;
            }

            if (expression === "cls") {
                console.clear();
                rl.prompt();
                return;
            }

            if (expression === "exit") {
                rl.close();
                return;
            }

            try {
                if (this.commandMode) {
                    this.executeCommand(expression);
                } else {
                    let node = this.parseExpression(expression).body[0].expression;
                    let result = this.evaluate(node);
                    console.log(result.toString());
                }
            } catch (error) {
                console.error(`Error: ${error.message}`);
            }

            rl.prompt();
        });

        rl.on('close', () => {
            process.exit(0);
        });

        // Use this to handle real-time input with highlighting
        rl.input.on('keypress', (char, key) => {
            setTimeout(() => {
                const currentLine = rl.line;
                const cursorPosition = rl.cursor;
                rl._refreshLine();
                const highlightedLine = this.highlightInput(currentLine);
                rl.output.write(`\r\x1b[K${rl._prompt}${highlightedLine}`);
                rl.output.write(`\r\x1b[${cursorPosition + rl._prompt.length}C`);
            }, 0);
        });
    }

    /**
     * Executes a command in command mode.
     * @param {string} command - The command to execute.
     */
    executeCommand(command) {
        if (command.toLowerCase() === 'set ran') {
            this.angleMode = 'rad';
        } else if (command.toLowerCase() === 'set deg') {
            this.angleMode = 'deg';
        } else {
            console.log(`Unknown command: ${command}`);
        }
    }

    /**
     * Provides tab completion for commands and functions.
     * @param {string} line - The current input line.
     * @returns {[string[], string]} The completion hits and the line.
     */
    completer(line) {
        const completions = 'set ran set deg cls exit sin cos tan'.split(' ');
        const hits = completions.filter((c) => c.startsWith(line));
        return [hits.length ? hits : completions, line];
    }
}

MathShell.prototype.OPERATORS = {
    '+': (a, b) => a.add(b),
    '-': (a, b) => a.sub(b),
    '*': (a, b) => a.mul(b),
    '/': (a, b) => {
        if (b.isZero()) {
            throw new Error('Division by zero error');
        }
        return a.div(b);
    },
    '**': (a, b) => a.pow(b),
    '%': (a, b) => {
        if (b.isZero()) {
            throw new Error('Modulo by zero error');
        }
        return a.mod(b);
    },
    '-': (a) => a.neg()
};

MathShell.prototype.FUNCTIONS = {
    'sin': (a) => Decimal.sin(a),
    'cos': (a) => Decimal.cos(a),
    'tan': (a) => Decimal.tan(a)
};

const shell = new MathShell();

const originalLog = console.log;
console.log = function(...args) {
    originalLog(chalk.reset(...args));
};

const originalError = console.error;
console.error = function(...args) {
    originalError(chalk.red(...args));
};

shell.runShell();
