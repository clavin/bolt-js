import {
  Middleware,
  AnyMiddlewareArgs,
  SlackActionMiddlewareArgs,
  SlackCommandMiddlewareArgs,
  SlackEventMiddlewareArgs,
  SlackOptionsMiddlewareArgs,
  SlackEvent,
  SlackAction,
  SlashCommand,
  OptionsRequest,
  InteractiveMessage,
  DialogSubmitAction,
  MessageAction,
  BlockElementAction,
} from '../types';
import { ActionConstraints } from '../App';

/**
 * Middleware that filters out any event that isn't an action
 */
export const onlyActions: Middleware<AnyMiddlewareArgs & { action?: SlackAction }> = ({ action, next }) => {
  // Filter out any non-actions
  if (action === undefined) {
    return;
  }

  // It matches so we should continue down this middleware listener chain
  next();
};

/**
 * Middleware that filters out any event that isn't a command
 */
export const onlyCommands: Middleware<AnyMiddlewareArgs & { command?: SlashCommand }> = ({ command, next }) => {
  // Filter out any non-commands
  if (command === undefined) {
    return;
  }

  // It matches so we should continue down this middleware listener chain
  next();
};

/**
 * Middleware that filters out any event that isn't an options
 */
export const onlyOptions: Middleware<AnyMiddlewareArgs & { options?: OptionsRequest }> = ({ options, next }) => {
  // Filter out any non-options requests
  if (options === undefined) {
    return;
  }

  // It matches so we should continue down this middleware listener chain
  next();
};

/**
 * Middleware that filters out any event that isn't an event
 */
export const onlyEvents: Middleware<AnyMiddlewareArgs & { event?: SlackEvent }> = ({ event, next }) => {
  // Filter out any non-events
  if (event === undefined) {
    return;
  }

  // It matches so we should continue down this middleware listener chain
  next();
};

/**
 * Middleware that checks for matches given constraints
 */
export function matchConstraints(
    constraints: ActionConstraints,
  ): Middleware<SlackActionMiddlewareArgs | SlackOptionsMiddlewareArgs> {
  return ({ payload, body, next, context }) => {
    // TODO: is putting matches in an array actually helpful? there's no way to know which of the regexps contributed
    // which matches (and in which order)
    let tempMatches: RegExpExecArray | null;
    const matches: any[] = [];

    if (constraints.block_id !== undefined) {
      if (!isBlockPayload(payload)) {
        return;
      }

      if (typeof constraints.block_id === 'string') {
        if (payload.block_id !== constraints.block_id) {
          return;
        }
      } else {
        if ((tempMatches = constraints.block_id.exec(payload.block_id)) !== null) {
          matches.concat(tempMatches);
        } else {
          return;
        }
      }
    }

    if (constraints.action_id !== undefined) {
      if (!isBlockPayload(payload)) {
        return;
      }

      if (typeof constraints.action_id === 'string') {
        if (payload.action_id !== constraints.action_id) {
          return;
        }
      } else {
        if ((tempMatches = constraints.action_id.exec(payload.action_id)) !== null) {
          matches.concat(tempMatches);
        } else {
          return;
        }
      }
    }

    if (constraints.callback_id !== undefined) {
      if (!isCallbackIdentifiedBody(body)) {
        return;
      }
      if (typeof constraints.callback_id === 'string') {
        if (body.callback_id !== constraints.callback_id) {
          return;
        }
      } else {
        if ((tempMatches = constraints.callback_id.exec(body.callback_id)) !== null) {
          matches.concat(tempMatches);
        } else {
          return;
        }
      }
    }

    // Add matches to context
    context['matches'] = matches;

    next();
  };
}

/*
 * Middleware that filters out messages that don't match pattern
 */
export function matchMessage(pattern: string | RegExp): Middleware<SlackEventMiddlewareArgs<'message'>> {
  return ({ message, context, next }) => {
    let tempMatches: RegExpExecArray | null;

    // Filter out messages that don't contain the pattern
    if (typeof pattern === 'string') {
      if (message.text !== undefined && !message.text.includes(pattern)) {
        return;
      }
    } else {
      if ((tempMatches = pattern.exec(message.text)) !== null) {
        context['matches'] = tempMatches;
      } else {
        return;
      }
    }

    next();
  };
}

/**
 * Middleware that filters out any command that doesn't match name
 */
export function matchCommandName(name: string): Middleware<SlackCommandMiddlewareArgs> {
  return ({ command, next }) => {
    // Filter out any commands that are not the correct command name
    if (name !== command.command) {
      return;
    }

    next();
  };
}

/**
 * Middleware that filters out any event that isn't of given type
 */
export function matchEventType(type: string): Middleware<SlackEventMiddlewareArgs> {
  return ({ event, next }) => {
    // Filter out any events that are not the correct type
    if (type !== event.type) {
      return;
    }

    next();
  };
}

export function ignoreSelf(): Middleware<AnyMiddlewareArgs> {
  return (args) => {
    // When context does not have a botId in it, then this middleware cannot perform its job. Bail immediately.
    if (args.context.botId === undefined) {
      // TODO: coded error
      args.next(new Error('Cannot ignore events from the app without a bot ID. ' +
        'Ensure authorize callback returns a botId.'));
      return;
    }

    const botId = args.context.botId as string;
    const botUserId = args.context.botUserId !== undefined ? args.context.botUserId as string : undefined;

    if (isEventArgs(args)) {
      // Once we've narrowed the type down to SlackEventMiddlewareArgs, there's no way to further narrow it down to
      // SlackEventMiddlewareArgs<'message'> without a cast, so the following couple lines do that.
      if (args.message !== undefined) {
        const message = args.message as SlackEventMiddlewareArgs<'message'>['message'];

        // TODO: revisit this once we have all the message subtypes defined to see if we can do this better with
        // type narrowing
        // Look for an event that is identified as a bot message from the same bot ID as this app, and return to skip
        if (message.subtype === 'bot_message' && message.bot_id === botId) {
          return;
        }
      }

      // Its an Events API event that isn't of type message, but the user ID might match our own app. Filter these out.
      if (botUserId !== undefined && args.event.user === botUserId) {
        return;
      }
    }

    // If all the previous checks didn't skip this message, then its okay to resume to next
    args.next();
  };
}

export function subtype(subtype: string): Middleware<SlackEventMiddlewareArgs<'message'>> {
  return ({ message, next }) => {
    if (message.subtype !== subtype) {
      next();
    }
  };
}

const slackLink = /<(?<type>[@#!])?(?<link>[^>|]+)(?:\|(?<label>[^>]+))?>/;

export function directMention(): Middleware<SlackEventMiddlewareArgs<'message'>> {
  return ({ message, context, next }) => {
    // When context does not have a botUserId in it, then this middleware cannot perform its job. Bail immediately.
    if (context.botUserId === undefined) {
      // TODO: coded error
      next(new Error('Cannot match direct mentions of the app without a bot user ID. ' +
        'Ensure authorize callback returns a botUserId.'));
      return;
    }

    // Match the message text with a user mention format
    const text = message.text.trim();

    const matches = slackLink.exec(text);
    if (
      matches === null || // stop when no matches are found
      matches.index !== 0 || // stop if match isn't at the beginning
      // stop if match isn't a user mention with the right user ID
      matches.groups === undefined || matches.groups.type !== '@' || matches.groups.link !== context.botUserId
    ) {
      return;
    }

    next();
  };
}

function isBlockPayload(
  payload: SlackActionMiddlewareArgs['payload'] | SlackOptionsMiddlewareArgs['payload'],
): payload is BlockElementAction | OptionsRequest<'block_suggestion'> {
  return (payload as BlockElementAction | OptionsRequest<'block_suggestion'>).action_id !== undefined;
}

type CallbackIdentifiedBody =
  | InteractiveMessage
  | DialogSubmitAction
  | MessageAction
  | OptionsRequest<'interactive_message' | 'dialog_suggestion'>;

function isCallbackIdentifiedBody(
  body: SlackActionMiddlewareArgs['body'] | SlackOptionsMiddlewareArgs['body'],
): body is CallbackIdentifiedBody {
  return (body as CallbackIdentifiedBody).callback_id !== undefined;
}

function isEventArgs(
  args: AnyMiddlewareArgs,
): args is SlackEventMiddlewareArgs {
  return (args as SlackEventMiddlewareArgs).event !== undefined;
}