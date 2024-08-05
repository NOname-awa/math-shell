import vorpal from 'vorpal';
import Decimal from 'decimal.js';
import esprima from 'esprima';
import fs from 'fs';
import path from 'path';

const configDir = path.join(process.env.HOME || process.env.USERPROFILE, '.config/mash');
const configFile = path.join(configDir, 'config.js');

// default config
const defaultConfig = `
module.exports = {
    // default angle mode (deg / rad)
    angleMode: 'deg',

    // prompt
    prompt: function(angleMode, commandMode) {
        return '\\u200B\\n' + (angleMode === 'deg' ? 'degree' : 'radian') + ' mode - ' + (commandMode ? 'command' : 'calc') + '\\n' + (commandMode ? '%' : '‣') + ' ';
    }
};
`;

// Create configuration directory and file (if not exist)
if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
}

if (!fs.existsSync(configFile)) {
    fs.writeFileSync(configFile, defaultConfig, 'utf-8');
}

// Dynamically import configuration file
async function loadConfig() {
    const config = await import(`file://${configFile}`);
    return config.default;
}

class MathShell {
    constructor(config) {
        this.angleMode = (config.angleMode === 'rad' ? 'rad' : 'deg') || 'deg';
        this.commandMode = false;
        this.promptFunc = config.prompt || ((angleMode, commandMode) => `${angleMode} ${commandMode ? '%' : '‣'} `);
        this.vars = {
            pi: Math.PI,
            e: Math.E
        }
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
            } catch (error) {
                throw new Error(error.message);
            }
        }

        return evaluateNode(node);
    }

    /**
     * Runs the interactive shell.
     */
    runShell() {
        const vorpalInstance = vorpal();

        // Remove the default exit command
        vorpalInstance.find('exit').remove();

        vorpalInstance
            .delimiter(this.promptFunc(this.angleMode, this.commandMode))
            .show();

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
            .action((args, callback) => {
                process.exit(0);
            });

        vorpalInstance
            .command('set <mode>', 'Set angle mode')
            .autocomplete(['rad', 'deg'])
            .action((args, callback) => {
                if (!this.commandMode) {
                    console.error('Error: set command can only be used in command mode');
                    callback();
                    return;
                }
                switch (args.mode) {
                    case 'rad':
                        this.angleMode = 'rad';
                        break;
                    case 'deg':
                        this.angleMode = 'deg';
                        break;
                    default:
                        console.error(`Unknown mode: ${args.mode}`);
                }
                vorpalInstance.delimiter(this.promptFunc(this.angleMode, this.commandMode));
                callback();
            });

        vorpalInstance
            .catch('[expression...]', 'Evaluate a mathematical expression')
            .autocomplete({
                data: () => this.commandMode 
                    ? ['ch', 'cls', 'exit', 'set rad', 'set deg']
                    : ['sin', 'cos', 'tan', 'abs', 'log', 'exp', 'sqrt', 'pi', 'e']
            })
            .action((args, callback) => {
                let expression = args.expression.join(' ').trim();
                if (expression === '') {
                    callback();
                    return;
                }

                if (this.commandMode) {
                    this.executeCommand(expression, vorpalInstance, callback);
                } else {
                    if (expression[0] === ':') {
                        this.executeCommand(expression.slice(1), vorpalInstance, callback);
                    } else {
                        try {
                            let node = this.parseExpression(expression).body[0].expression;
                            let result = this.evaluate(node);
                            console.log(result.toString());
                        } catch (error) {
                            console.error(`Error: ${error.message}`);
                        }
                        callback();
                    }
                }
            });
    }

    /**
     * Executes a command in command mode.
     * @param {string} command - The command to execute.
     * @param {Object} vorpalInstance - The vorpal instance.
     * @param {function} callback - The callback function.
     */
    executeCommand(command, vorpalInstance, callback) {
        const commandArr = command.split(' ').filter(elm => elm);
        switch (commandArr[0]) {
            case 'set': {
                switch (commandArr[1]) {
                    case 'rad': this.angleMode = 'rad'; break;
                    case 'deg': this.angleMode = 'deg'; break;
                    default: console.error(`Unknown command: ${commandArr[1]}`);
                }
                vorpalInstance.delimiter(this.promptFunc(this.angleMode, this.commandMode));
                break;
            }
            default: console.error(`Unknown command: ${commandArr[0]}`);
        }
        callback();
    }

    /**
     * Process command line arguments and evaluate if present.
     * @param {string[]} args - Command line arguments.
     */
    processArgs(args) {
        let mode = this.angleMode;
        let expression = [];

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
            try {
                let expr = expression.join(' ');
                let node = this.parseExpression(expr).body[0].expression;
                let result = this.evaluate(node);
                console.log(result.toString());
                process.exit(0);
            } catch (error) {
                console.error(`Error: ${error.message}`);
                process.exit(1);
            }
        } else {
            this.runShell();
        }
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

const toDeg = (arg, mode) => {
    if (mode === 'deg') {
        arg = Decimal.acos(-1).mul(arg).div(180);  // Convert degrees to radians
    }
    return arg;
}

MathShell.prototype.FUNCTIONS = {
    'sin': (a, mode) => Decimal.sin(toDeg(a, mode)),
    'cos': (a, mode) => Decimal.cos(toDeg(a, mode)),
    'tan': (a, mode) => Decimal.tan(toDeg(a, mode)),
    'abs': (a, mode) => Decimal.abs(a),
    'log': (a, mode) => Decimal.log(a),
    'exp': (a, mode) => Decimal.exp(a),
    'sqrt': (a, mode) => Decimal.sqrt(a)
};

(async () => {
    const config = await loadConfig();
    const shell = new MathShell(config);
    const args = process.argv.slice(2); // Get command line arguments
    shell.processArgs(args);
})();
