import vorpal from 'vorpal';
import Decimal from 'decimal.js';
import esprima from 'esprima';
import fs from 'fs';
import path from 'path';

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.config/mash');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.js');

// Default configuration
const DEFAULT_CONFIG = `
module.exports = {
    angleMode: 'deg',
    prompt: function(angleMode, commandMode) {
        return '\\u200B\\n' + (angleMode === 'deg' ? 'degree' : 'radian') + ' mode - ' + (commandMode ? 'command' : 'calc') + '\\n' + (commandMode ? '%' : '‣') + ' ';
    }
};
`;

// Ensure configuration file exists
if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
}
if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, DEFAULT_CONFIG, 'utf-8');
}

// Dynamically import configuration file
async function loadConfig() {
    const config = await import(`file://${CONFIG_FILE}`);
    return config.default;
}

class MathShell {
    constructor(config) {
        this.angleMode = config.angleMode === 'rad' ? 'rad' : 'deg';
        this.commandMode = false;
        this.promptFunc = config.prompt || this.defaultPrompt;
        this.vars = {
            pi: Math.PI,
            e: Math.E,
            ans: 0
        };
    }

    defaultPrompt(angleMode, commandMode) {
        return `${angleMode} ${commandMode ? '%' : '‣'} `;
    }

    parseExpression(expression) {
        expression = expression.replace(/\$(\w+)/g, (match, p1) => {
            const varName = p1.toLowerCase();
            if (this.vars.hasOwnProperty(varName)) {
                return this.vars[varName].toString();
            } else {
                throw new Error(`Undefined variable: ${p1}`);
            }
        });

        try {
            let parsedExpression = esprima.parseScript(expression);
            this.markUnaryMinus(parsedExpression.body[0].expression);
            return parsedExpression;
        } catch (error) {
            throw new SyntaxError(`Syntax Error: ${error.message} in expression "${expression}"`);
        }
    }

    markUnaryMinus(node) {
        if (node.type === 'BinaryExpression') {
            this.markUnaryMinus(node.left);
            this.markUnaryMinus(node.right);
        } else if (node.type === 'UnaryExpression' && node.operator === '-') {
            node.isUnaryMinus = true;
        }
    }

    evaluate(node) {
        const self = this;

        function evaluateNode(node) {
            let result;
            switch (node.type) {
                case 'Literal':
                    result = new Decimal(node.value);
                    break;
                case 'BinaryExpression':
                    result = self.OPERATORS[node.operator](evaluateNode(node.left), evaluateNode(node.right));
                    break;
                case 'UnaryExpression':
                    result = node.isUnaryMinus 
                        ? self.OPERATORS['-unary'](evaluateNode(node.argument))
                        : self.OPERATORS[node.operator](evaluateNode(node.argument));
                    break;
                case 'CallExpression':
                    const func = node.callee.name;
                    if (self.FUNCTIONS[func]) {
                        const arg = evaluateNode(node.arguments[0]);
                        result = self.FUNCTIONS[func](arg, self.angleMode);
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
        }

        return evaluateNode(node);
    }

    runShell() {
        const vorpalInstance = vorpal();
        vorpalInstance.find('exit').remove();

        vorpalInstance
            .delimiter(this.promptFunc(this.angleMode, this.commandMode))
            .show();

        this.setupCommands(vorpalInstance);
    }

    setupCommands(vorpalInstance) {
        vorpalInstance
            .command('ch', 'Toggle command mode')
            .action((args, callback) => {
                this.commandMode = !this.commandMode;
                vorpalInstance.delimiter(this.promptFunc(this.angleMode, this.commandMode));
                callback();
            });

        vorpalInstance
            .command('cls', 'Clear the screen')
            .action((args, callback) => {
                console.clear();
                callback();
            });

        vorpalInstance
            .command('exit', 'Exit the shell')
            .action(() => process.exit(0));

        vorpalInstance
            .command('set <mode>', 'Set angle mode')
            .autocomplete(['rad', 'deg'])
            .action((args, callback) => {
                if (!this.commandMode) {
                    console.error('Error: set command can only be used in command mode');
                    callback();
                    return;
                }
                this.angleMode = args.mode.toLowerCase();
                vorpalInstance.delimiter(this.promptFunc(this.angleMode, this.commandMode));
                callback();
            });

        vorpalInstance
            .command('var <name> = <value>', 'Set a variable')
            .action((args, callback) => {
                if (!this.commandMode) {
                    console.error('Error: var command can only be used in command mode');
                    callback();
                    return;
                }
                const varName = args.name.toLowerCase();
                this.vars[varName] = new Decimal(args.value);
                console.log(`Variable ${varName} set to ${args.value}`);
                callback();
            });

        vorpalInstance
            .catch('[expression...]', 'Evaluate a mathematical expression')
            .action((args, callback) => {
                const expression = args.expression.join(' ').trim();
                if (expression) {
                    this.evaluateExpression(expression, vorpalInstance, callback);
                } else {
                    callback();
                }
            });
    }

    evaluateExpression(expression, vorpalInstance, callback) {
        if (this.commandMode) {
            this.executeCommand(expression, vorpalInstance, callback);
        } else {
            if (expression.startsWith(':')) {
                this.executeCommand(expression.slice(1), vorpalInstance, callback);
            } else {
                try {
                    const node = this.parseExpression(expression).body[0].expression;
                    const result = this.evaluate(node);
                    this.vars.ans = result;
                    console.log(result.toString());
                } catch (error) {
                    console.error(`Error: ${error.message}`);
                }
                callback();
            }
        }
    }

    executeCommand(command, vorpalInstance, callback) {
        const commandArr = command.split(' ').filter(Boolean);
        switch (commandArr[0].toLowerCase()) {
            case 'set':
                this.angleMode = commandArr[1].toLowerCase();
                vorpalInstance.delimiter(this.promptFunc(this.angleMode, this.commandMode));
                break;
            case 'var':
                if (commandArr.length === 4 && commandArr[2] === '=') {
                    const varName = commandArr[1].toLowerCase();
                    this.vars[varName] = new Decimal(commandArr[3]);
                    console.log(`Variable ${varName} set to ${commandArr[3]}`);
                } else {
                    console.error('Invalid var command. Usage: var <name> = <value>');
                }
                break;
            default:
                console.error(`Unknown command: ${commandArr[0]}`);
        }
        callback();
    }

    processArgs(args) {
        let mode = this.angleMode;
        const expression = [];

        args.forEach(arg => {
            if (arg === '--rad') {
                mode = 'rad';
            } else if (arg === '--deg') {
                mode = 'deg';
            } else {
                expression.push(arg);
            }
        });

        this.angleMode = mode;

        if (expression.length > 0) {
            this.evaluateFromArgs(expression.join(' '));
        } else {
            this.runShell();
        }
    }

    evaluateFromArgs(expression) {
        try {
            const node = this.parseExpression(expression).body[0].expression;
            const result = this.evaluate(node);
            this.vars.ans = result;
            console.log(result.toString());
            process.exit(0);
        } catch (error) {
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    }
}

MathShell.prototype.OPERATORS = {
    '+': (a, b) => a.add(b),
    '-': (a, b) => a.sub(b),
    '*': (a, b) => a.mul(b),
    '/': (a, b) => {
        if (b.isZero()) throw new Error('Division by zero error');
        return a.div(b);
    },
    '**': (a, b) => a.pow(b),
    '%': (a, b) => {
        if (b.isZero()) throw new Error('Modulo by zero error');
        return a.mod(b);
    },
    '-unary': (a) => a.neg()
};

const toDeg = (arg, mode) => {
    if (mode === 'deg') {
        return Decimal.acos(-1).mul(arg).div(180);
    }
    return arg;
};

MathShell.prototype.FUNCTIONS = {
    sin: (a, mode) => Decimal.sin(toDeg(a, mode)),
    cos: (a, mode) => Decimal.cos(toDeg(a, mode)),
    tan: (a, mode) => Decimal.tan(toDeg(a, mode)),
    abs: (a) => Decimal.abs(a),
    log: (a) => Decimal.log(a),
    exp: (a) => Decimal.exp(a),
    sqrt: (a) => Decimal.sqrt(a)
};

(async () => {
    const config = await loadConfig();
    const shell = new MathShell(config);
    const args = process.argv.slice(2);
    shell.processArgs(args);
})();
