import React from 'react';
import ReactDOM from 'react-dom';
import {ArticleList, ArticleItem} from './components';

import {AsyncProps} from 'react-jsonapi';
import {Link, Router, Route, browserHistory} from 'react-router'

const Home = React.createClass({
    render() {
        return <div>
            <p>
                <Link to={"/articles"}>Link</Link>
            </p>
            <p>
                <Link to={"/articles/10"}>Deep Link</Link>
            </p>
        </div>
    }
});

ReactDOM.render((
    <Router 
        history={browserHistory}
        render={(props) => <AsyncProps {...props} />}
    >
        <Route path="/" component={Home} /> 
        <Route path="/articles" component={ArticleList}>
            <Route path=":articleId" component={ArticleItem} />
        </Route>
    </Router>
), document.getElementById('container'));