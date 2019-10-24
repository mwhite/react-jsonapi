import React from 'react';
import createReactClass from 'create-react-class';
import PropTypes from 'prop-types';
import Backbone from 'backbone';
import 'backbone-relational';
import _ from 'underscore';
import './backbone-relational-jsonapi';

export { default as AsyncProps } from './AsyncProps';

// Monkey-patch to fix an apparent bug.
Backbone.RelationalModel.prototype.set = function( key, value, options ) {
    Backbone.Relational.eventQueue.block();

    // Duplicate backbone's behavior to allow separate key/value parameters, instead of a single 'attributes' object
    var attributes,
        result;

    if ( _.isObject( key ) || key == null ) {
        attributes = key;
        options = value;
    }
    else {
        attributes = {};
        attributes[ key ] = value;
    }

    try {
        var id = this.id,
            newId = attributes && this.idAttribute in attributes && attributes[ this.idAttribute ];

        // Check if we're not setting a duplicate id before actually calling `set`.
        Backbone.Relational.store.checkId( this, newId );

        result = Backbone.Model.prototype.set.apply( this, arguments );

        // Ideal place to set up relations, if this is the first time we're here for this model
        // Change required to work.
        if ( true ) {
        //if ( !this._isInitialized && !this.isLocked() ) {
            this.constructor.initializeModelHierarchy();

            // Only register models that have an id. A model will be registered when/if it gets an id later on.
            if ( newId || newId === 0 ) {
                Backbone.Relational.store.register( this );
            }

            this.initializeRelations( options );
        }
        // The store should know about an `id` update asap
        else if ( newId && newId !== id ) {
            Backbone.Relational.store.update( this );
        }

        if ( attributes ) {
            this.updateRelations( attributes, options );
        }
    }
    finally {
        // Try to run the global queue holding external events
        Backbone.Relational.eventQueue.unblock();
    }

    return result;
};

const modelEvents = 'change invalid error request sync';
const collectionEvents = 'update reset sort error request sync';

Backbone.Collection.prototype.bindRelationEvents = function (callback, context, options) {
    this.on(collectionEvents, callback, context);
    this.models.forEach((model) => {
        model.bindRelationEvents(callback, context, options);
    });
    
    this.on('add', (model) => {
        model.bindRelationEvents(callback, context, options);
    }, context);

    this.on('remove', (model) => {
        model.unbindRelationEvents(context, options);
    }, context);
};

Backbone.RelationalModel.prototype.bindRelationEvents = function (callback, context, options) {
    const relations = getRelations(options);

    this.on(modelEvents, callback, context);
    
    relations.forEach((relation) => {
        const related = getRelated(this, relation);
        related.bindRelationEvents(callback, context, relation);
    });
};

Backbone.Collection.prototype.unbindRelationEvents = function (context, options) {
    this.models.forEach((model) => {
        model.unbindRelationEvents(context, options);
    });

    this.off(null, null, context);
};

Backbone.RelationalModel.prototype.unbindRelationEvents = function (context, options) {
    this.off(null, null, context);

    const relations = getRelations(options);

    relations.forEach((relation) => {
        const related = getRelated(this, relation);
        related.unbindRelationEvents(context, relation);
    });
};

const getRelations = (options) => {
    let relations = options.relations || [];
    (options.fragments || []).forEach((fragment) => {
        relations = relations.concat(fragment.relations || []);
    });
    return _.uniq(relations, (r) => r.key)
};

const getRelated = (model, relation) => {
    let r = model.getRelation(relation.key);
    return r.related;
};

const BackboneSync = Backbone.sync;

Backbone.sync = function (method, model, options) {
    if (!options.url) {
        options.url = getUrl(model, model.fetchOptions);
    }

    return new Promise((resolve, reject) => {
        model.syncing = true;
        model.textStatus = null;

        const promise = BackboneSync(method, model, options);
        promise.done((data, textStatus) => {
            model.error = null;

            resolve(model);
        }).fail((jqXhr, textStatus, errorThrown) => {
            model.error = errorThrown;

            if (options.allowFail) {
                reject(model);
            } else {
                resolve(model);
            }
        }).always(() => {
            model.syncing = false;
            // Required to ensure handlers see attributes set above.
            model.trigger('change');
        })
    });
};

function getUrl(model, fetchOptions) {
    fetchOptions = fetchOptions || {};
    const urlRoot = model.urlRoot;

    if (!urlRoot) {
        throw new Error("Missing urlRoot", model);
    }
    let url = urlRoot;
    if (model instanceof Backbone.Model) {
        const id = fetchOptions.id || model.get(model.idAttribute);
        if (id) {
            url += `/${id}`;
        }
    }

    const include = [];
    const fields = {};

    processRelation(
        model.model ? model.model : model.constructor, 
        fetchOptions,
        [],
        include,
        fields
    );

    const { sort, filter, page } = fetchOptions;
    const params = [];

    if (include.length) {
        const includes = _.sortBy(_.uniq(include.map((include) => {
            return include.join('.');
        })), _.identity);
        params.push(`include=${includes.join(',')}`);
    }

    _.each(_.sortBy(_.keys(fields), _.identity), (type) => {
        const typeFields = _.sortBy(_.uniq(fields[type]), _.identity);
        params.push(`fields[${type}]=${typeFields.join(',')}`);
    });

    if (sort) {
        params.push(`sort=${sort}`);
    }

    if (filter) {
        if (typeof filter === "object") {
            _.each(_.sortBy(_.keys(filter), _.identity), (key) => {
                const keyVal = filter[key];
                params.push(`filter[${key}]=${keyVal}`);
            });
        } else {
            params.push(`filter=${filter}`);
        }
    }

    if (page) {
        if (typeof page === "object") {
            _.each(_.sortBy(_.keys(page), _.identity), (key) => {
                const keyVal = page[key];
                params.push(`page[${key}]=${keyVal}`);
            });
        } else {
            params.push(`page=${page}`);
        }
    }

    if (params.length) {
        url += '?' + params.join('&');
    }

    return url;
}

const processRelation = (model, relation, path, include, fields) => {
    const fragments = relation.fragments || [];
    let relationRelations = relation.relations || [];
    let relationFields = relation.fields || [];
    fragments.forEach((fragment) => {
        relationRelations = relationRelations.concat(fragment.relations || []);
        relationFields = relationFields.concat(fragment.fields || []);
    });
    relationRelations = _.uniq(relationRelations, (r) => r.key)

    if (relationFields.length) {
        const type = model.prototype.defaults.type;
        fields[type] = (fields[type] || []).concat(relationFields)
    }

    relationRelations.forEach((relation) => {
        const newPath = path.concat(relation.key);
        include.push(newPath);
        const relatedModel = _.find(model.prototype.relations, (r) => {
            return r.key === relation.key;
        }).relatedModel;
        processRelation(relatedModel, relation, newPath, include, fields)
    });

};

export function withJsonApi(options, WrappedComponent) {
    const componentQueries = options.queries || {};
    const componentFragments = options.fragments || {};
    const initialVars = options.initialVars;
    const getInitialVars = options.getInitialVars;

    const displayName = WrappedComponent.displayName || WrappedComponent.name;

    const getVars = () => {
        if (getInitialVars) {
            return getInitialVars();
        } else if (initialVars) {
            return initialVars;
        } else {
            return {};
        }
    };
    
    const firstQuery = _.first(_.values(componentQueries));
    const isStandalone = firstQuery && 
        getArgs(firstQuery).indexOf("props") !== -1;
    const innerDisplayNameType = isStandalone ? 'withJsonApi' : 'withJsonApiInner';

    const ApiComponent = createReactClass({
        displayName: displayName 
            ? `${innerDisplayNameType}(${displayName})`
            : undefined,

        propTypes: Object.assign(
            {}, 
            WrappedComponent.propTypes,
            {
                initialQueries: PropTypes.object
            }
        ),

        statics: {
            loadProps({ params, location, loadContext, props }, cb) {
                const queries = new Queries({
                    element: null, 
                    vars: getVars(),
                    propTypes: componentQueries
                });

                queries._fetch({ params, location, loadContext, props }).then(() => {
                    cb(null, {
                        initialQueries: queries
                    });
                });
            },
            queries: componentQueries,
            fragments: componentFragments,
            initialVars: initialVars,
            getInitialVars: getInitialVars
        },

        componentWillMount() {
            this.fragmentProps = {};
            this.componentWillReceiveProps(this.props);
        },
        
        componentWillReceiveProps(nextProps) {
            const isMatch = (props1, props2) => {
                const props1Keys = Object.keys(props1);
                return _.isEqual(
                    _.sortBy(props1Keys, _.identity),
                    _.sortBy(Object.keys(props2), _.identity)
                ) && _.all(props1Keys.map((key) => {
                    return props1[key] === props2[key];
                }));
            };
            const fragmentProps = _.pick(
                nextProps, 
                Object.keys(componentFragments)
            );
            const hasFragmentProps = Object.keys(fragmentProps).length;

            if (nextProps.initialQueries && 
                nextProps.initialQueries !== this.queries
            ) {
                if (this.queries) {
                    this.queries._events._removeHandlers();
                }
                this.queries = nextProps.initialQueries;
                this.queries._element = this.queries._events.element = this;
                this.queries._events._addHandlers();
            }

            if (hasFragmentProps && !_.isMatch(this.fragmentProps, fragmentProps)) {
                this.fragmentProps = fragmentProps;
                if (this.fragments) {
                    this.fragments._events._removeHandlers();
                }
                this.fragments = new QueryFragments({
                    element: this, 
                    props: fragmentProps, 
                    propTypes: componentFragments
                });
                this.fragments._events._addHandlers();
            }
        },

        componentWillUnmount() {
            if (this.queries) {
                this.queries._events._removeHandlers();
            }
            if (this.fragments) {
                this.fragments._events._removeHandlers();
            }
        },

        render() {
            return (
                <WrappedComponent
                    {...this.props}
                    {...this.queries ? {queries: this.queries} : {}}
                    {...this.queries ? this.queries._queryProps : {}}
                    {...this.fragments ? this.fragments._props : {}}
                />
            );
        }
    });
    
    if (isStandalone) {
        return createReactClass({
            displayName: displayName 
                ? `withJsonApi(${displayName})` 
                : undefined,

            componentWillMount() {
                this.initialQueries = null;
                this.componentWillReceiveProps(this.props);
            },

            componentWillReceiveProps(nextProps) {
                ApiComponent.loadProps({ props: nextProps }, (error, props) => {
                    this.initialQueries = props.initialQueries;
                    this.forceUpdate();
                });
            },

            render() {
                return (
                    <ApiComponent 
                        initialQueries={this.initialQueries}
                        {...this.props} />
                );
            }
        });
    } else {
        return ApiComponent;
    }

}

function Events(props, propOptions, element) {
    this.props = props;
    this.propOptions = propOptions;
    this.element = element;
}

Object.assign(Events.prototype, {
    _addHandlers() {
        const forceUpdate = () => {
            if (this.element) {
                this.element.forceUpdate(); 
            } 
        };

        Object.keys(this.props).forEach((key) => {
            const options = this.propOptions[key];

            this.props[key].bindRelationEvents(forceUpdate, this.element, options)
        });

        this._addedHandlers = true;
    },

    _removeHandlers() {
        Object.keys(this.props).forEach((key) => {
            this.props[key].unbindRelationEvents(this.element, this.propOptions[key]);
        });
    }
});

function QueryFragments({ element, props, propTypes }) {
    this._events = new Events(props, propTypes, element);

    this._element = element;

    this._props = props;
    this._propTypes = propTypes;
}

function Queries({ 
    element, vars, propTypes,
    loadFromCache, alwaysFetch, updateCache 
}) {
    this._events = new Events(null, propTypes, element);

    this._element = element;

    this.vars = vars;
    this.pendingVars = {};
    this._queryProps = {};

    this._queryPropTypes = propTypes;
    this.loadFromCache = !_.isUndefined(loadFromCache) ? loadFromCache : true;
    this.alwaysFetch = !_.isUndefined(alwaysFetch) ? alwaysFetch : true;
    this.updateCache = !_.isUndefined(updateCache) ? updateCache : true;

    this._addedHandlers = false;
}

const collectionCache = {};

function findOrCreateCollection(model, fetchOptions) {
    const url = getUrl(model.prototype, fetchOptions);
    let isNew = false;

    if (!collectionCache[url]) {
        collectionCache[url] = new model();
        isNew = true;
    }

    return { isNew, collection: collectionCache[url] };
}

function getArgs(func) {
    // First match everything inside the function argument parens.
    var args = func.toString().match(/\(([^)]*)\)/)[1];

    // Split the arguments string into an array comma delimited.
    return args.split(',').map(function(arg) {
        // Ensure no inline comments are parsed and trim the whitespace.
        return arg.replace(/\/\*.*\*\//, '').trim();
    }).filter(function(arg) {
        // Ensure no undefined values are added.
        return arg;
    });
}

Object.assign(Queries.prototype, {
    getCacheOption(options, name) {
        const option = options[name];
        const thisVal = this[name];

        return !_.isUndefined(option)
            ? option
            : (!_.isUndefined(thisVal)
                    ? thisVal
                    : true);
    },

    /**
     * Set the current vars to `vars` and trigger a re-fetch.  Once fetching is
     * initiated, the component will re-render with the previous vars as
     * queries.vars and the current vars as queries.pendingVars.
     */
    setVars(vars) {
        this.pendingVars = Object.assign({}, this.vars, vars);
        this._fetch(this._element.props);
    },

    _fetch({ params, location, loadContext, props }) {
        const keys = Object.keys(this._queryPropTypes);

        if (!keys.length) {
            return Promise.resolve();
        }

        const fetchingProps = {};

        this.fetching = true;
        
        if (this._events.props) {
            this._events._removeHandlers();
        }
        
        const propOptions = {};
        this.hasErrors = false;

        const promise = Promise.all(keys.map((key) => {
            return new Promise((resolve) => {
                const query = this._queryPropTypes[key];
                const options = propOptions[key] = getArgs(query).indexOf("props") !== -1
                    ? query(props, this.pendingVars)
                    : query(params, location.query, this.pendingVars);

                const model = options.model;
                let instance, isNew;

                if (model.prototype.model) {
                    if (this.getCacheOption(options, 'updateCache')) {
                        ({ 
                          collection: instance, 
                          isNew 
                        } = findOrCreateCollection(model, options));
                    } else {
                        instance = new model();
                        instance.fetchOptions = options;
                        isNew = true;
                    }
                } else {
                    instance = model.findOrCreate({
                        [model.prototype.idAttribute]: options.id
                    });
                }

                instance._isInitialized = false;
                fetchingProps[key] = instance;

                let loadedFromCache = false;

                if (this.getCacheOption(options, 'loadFromCache')) {
                    if (model.prototype.model && !isNew) {
                        loadedFromCache = true;
                        resolve();
                    }
                }

                const existingFetchPromise = instance.fetchPromise;

                if (existingFetchPromise) {
                    existingFetchPromise.then(() => {
                        resolve();
                    }).catch(() => {
                        resolve();
                    });
                } else {
                    if (loadedFromCache && !this.getCacheOption(
                        options, 'alwaysFetch'
                    )) {
                        return;
                    }

                    instance.fetchOptions = options;

                    const fetchPromise = instance.fetch();

                    instance.fetchPromise = fetchPromise;

                    fetchPromise.catch(() => {
                        this.hasErrors = true;
                        instance.fetchPromise = null;
                        resolve();
                    }).then(() => {
                        instance.fetchPromise = null;
                        resolve();
                    });
                }
            });
        }));

        promise.then(() => {
            const isAlreadyLoaded = this._events.props;
            this._queryProps = fetchingProps;
            this._events.propOptions = propOptions;
            this._events.props = this._queryProps;
            
            this.vars = this.pendingVars;
            this.pendingVars = null;
            this.fetching = false;
            
            if (isAlreadyLoaded) {
                this._events._addHandlers();
                this._element.forceUpdate();
            }
        });

        return promise;
    }
});


