import readline from 'readline';
import * as math from 'mathjs';
import esprima from 'esprima';
import chalk from 'chalk';

class MathShell {
    constructor() {
        this.angleMode = 'deg';
        this.commandMode = false;
    }

    parseExpression(expression) {
        return esprima.parseScript(expression);
    }

    evaluate(node) {
        let self = this;

        function evaluateNode(node) {
            switch (node.type) {
                case 'Literal':
                    return node.value;
                case 'BinaryExpression':
                    return self.OPERATORS[node.operator](evaluateNode(node.left), evaluateNode(node.right));
                case 'UnaryExpression':
                    return self.OPERATORS[node.operator](evaluateNode(node.argument));
                case 'CallExpression':
                    let func = node.callee.name;
                    if (self.FUNCTIONS[func]) {
                        let arg = evaluateNode(node.arguments[0]);
                        if (self.angleMode === 'deg') {
                            arg = math.unit(arg, 'deg').toNumber('rad');
                        }
                        return self.FUNCTIONS[func](arg);
                    } else {
                        throw new Error(`Unsupported function: ${func}`);
                    }
                default:
                    throw new Error(`Unsupported type: ${node.type}`);
            }
        }

        return evaluateNode(node);
    }

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
                    console.log(result);
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

    executeCommand(command) {
        if (command.toLowerCase() === 'set ran') {
            this.angleMode = 'rad';
        } else if (command.toLowerCase() === 'set deg') {
            this.angleMode = 'deg';
        } else {
            console.log(`Unknown command: ${command}`);
        }
    }

    completer(line) {
        const completions = 'set ran set deg cls exit sin cos tan'.split(' ');
        const hits = completions.filter((c) => c.startsWith(line));
        return [hits.length ? hits : completions, line];
    }
}

MathShell.prototype.OPERATORS = {
    '+': math.add,
    '-': math.subtract,
    '*': math.multiply,
    '/': math.divide,
    '**': math.pow,
    '%': math.mod,
    '-': math.unaryMinus
};

MathShell.prototype.FUNCTIONS = {
    'sin': math.sin,
    'cos': math.cos,
    'tan': math.tan
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
